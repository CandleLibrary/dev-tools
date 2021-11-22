import { Logger } from "@candlelib/log";
import { col_css, getPackageJsonObject, xtColor, xtF, xtReset } from "@candlelib/paraffin";
import URI from '@candlelib/uri';
import child_process, { exec, execSync } from "child_process";
import fs from "fs";
import path from "path";
import { stdout } from 'process';
import { CommitLog, Dependencies, Dependency, DevPkg, TestStatus, Version } from "../types/types";
import { gitLog, gitStatus } from "./git.js";
const dev_logger = Logger.get("dev-tools").activate();

const fsp = fs.promises;


const channel_hierarchy = {
    "": 100000,
    "release": 50000,
    "beta": 25000,
    "alpha": 12500,
    "experimental": 6250,
};

/**
 * Retrieve a candle library repo package.json object given the package name 
 * of the repo. By default retrieves the package.json from the active workspace
 * repo folder. An alternate root workspace directory can specified with `ws_dir` 
 * argument. 
 * 
 * @param candle_lib_name - Name of the package to retrieve. e.g `@candlelib/hydrocarbon`.
 *                          The `@candlelib/` can be omitted if desired
 * 
 * @param ws_dir - Optional: The directory in which to search for the Candle Library repo.
 * 
 * @returns package.json object or null if repo cannot be located
 */
export async function getPackageData(candle_lib_name: string):
    Promise<DevPkg> {

    const resolved_path = URI.resolveRelative(candle_lib_name);

    const { realpath } = await import("fs/promises");

    const path = await realpath(resolved_path + "");

    const { package: pkg, FOUND } = await getPackageJsonObject(path + "/");

    if (FOUND && pkg && pkg.name == candle_lib_name) {
        pkg._workspace_location = path;
        return <any>pkg;
    }

    return null;
}

/**
 * Runs the testing system in a new process for the givin project
 */
export function testPackage(pkg: DevPkg): Promise<boolean> {
    return new Promise((res) => {

        const CWD = pkg._workspace_location;

        const test = pkg.scripts.test;
        child_process.exec(test, { cwd: CWD, }, (err, out, stderr) => {
            if (err) {
                dev_logger.get(`testing [${pkg.name}]`).error("Package failed testing");
                //dev_logger.get(`testing [${pkg.name}]`).error(out + stderr);
                res(false);
            } else
                res(true);
        });
    });
}


/**
 * Retrieves a list of direct and indirect candlelib dependencies of the specified module
 * @param package_name 
 * @param dependencies 
 * @returns 
 */
export async function* getPackageDependenciesGen(
    prev_tracked_commit: string,
    dep: Dependency,
    getDependencyNames: (DevPkg) => string[],
    dependencies: Dependencies = new Map([[dep.name, dep]])
): AsyncGenerator<{ dep: Dependency, dependencies: Dependencies; }, Dependencies> {

    if (!dep)
        throw new Error("pkg argument is undefined");

    if (dep.package?.dependencies) {

        const cl_depends = getDependencyNames(dep.package);

        for (const dependent_name of cl_depends) {

            if (!dependencies.has(dependent_name)) {

                const dep_pkg = await getPackageData(dependent_name);

                if (dep_pkg) {

                    dev_logger.log(`Get dependency ${dependent_name}`);

                    const dep = await createDepend(dep_pkg, prev_tracked_commit);

                    dependencies.set(dependent_name, dep);

                    dependencies.get(dependent_name).reference_count++;

                    yield* (await getPackageDependenciesGen(prev_tracked_commit, dep, getDependencyNames, dependencies));


                } else {
                    throw new Error(`Cannot locate package ${dependent_name} required by ${dep.name}`);
                }
            } else {
                dependencies.get(dependent_name).reference_count++;
            }
        }
    }


    yield { dep, dependencies };

    return dependencies;
}

export async function createDepend(dep_pkg: string | DevPkg, prev_commit: string = ""): Promise<Dependency> {

    if (typeof dep_pkg == "string")
        dep_pkg = await getPackageData(dep_pkg);

    if (dep_pkg) {

        const CWD = dep_pkg._workspace_location;

        const commit_string = gitLog(CWD, dep_pkg._workspace_location, prev_commit);

        console.log({ commit_string });

        const commits: CommitLog[] = <any>commit_string
            .split(/^\s*commit\s*/mg)
            .map(str => str.match(/^(?<hash>.*)$\s*author\s*\:(?<author>.*)$\s*date\s*\:(?<date>.*)$(?<message>(.|\.|[\n\s\r])+)/mi)?.groups)
            //.map(g => { if (g) { const [head, body] = g.message.split(/\n/g); g.head = head + ""; g.body = body + ""; } return g; })
            .map(g => { if (g) for (const name in g) g[name] = g[name].trim(); return g; })
            .filter(m => !!m);

        const DIRTY_REPO = gitStatus(CWD, dep_pkg._workspace_location).length > 0;

        const dep: Dependency = {
            name: dep_pkg.name,
            package: dep_pkg,
            TEST_STATUS: TestStatus.NOT_RUN,
            reference_count: 0,
            new_version: "",
            current_version: dep_pkg.version,
            commits,
            DIRTY_REPO,
            PROCESSED: false,
            version_data: null
        };

        dep.version_data = await getNewVersionNumber(dep);

        return dep;
    }

    return null;
}

/**
 * Calculates the next version number based on current version info within
 * package.json and git commit logs, and type of changes observed in git 
 * logs since last version.
 * 
 * @param dep 
 * @param release_channel 
 * @param PRE_RELEASE 
 * @returns 
 */
export function getNewVersionNumber(dep: Dependency, release_channel = "", RELEASE = false) {
    //Traverse commits and attempt to find version commits
    return new Promise((res, reject) => {

        const pkg_version = parseVersion(dep.package.version);
        exec(`npm show ${dep.name} version`, (error, stdout) => {

            let npm_version_string = stdout.toString().match(/^.*(\d+\.\d+\.\d+\w*)/)[1].trim();

            let BREAKING = false, FEATURE = false, commit_drift = 0;

            for (const commit of dep.commits) {
                if (Commit_Is_Top_Of_Prev_Version(commit, dep)) {

                    break;
                } else if (!BREAKING && commit.message.match(/^\#?[Bb]reak(ing)?/g)) {
                    BREAKING = true;
                } else if (!FEATURE && commit.message.match(/^\#?[Ff]eat(ure)?/g)) {
                    FEATURE = true;
                }
                commit_drift++;
            }

            const npm_version = parseVersion(npm_version_string);

            const latest_version = getLatestVersion(pkg_version, npm_version);

            RELEASE = RELEASE || latest_version.sym[0] > 0;

            // Package version is always the version released to package repositories
            let new_version = parseVersion(versionToString(latest_version));

            if (BREAKING) {
                if (RELEASE) {
                    new_version.sym[0]++;
                    new_version.sym[1] = 0;
                } else new_version.sym[1]++;
                new_version.sym[2] = 0;
            } else if (FEATURE) {
                new_version.sym[1]++;
                new_version.sym[2] = 0;
            } else {
                new_version.sym[2]++;
            }

            new_version.channel = release_channel;

            if (commit_drift > 0) {
                pkg_logger(dep).log(`Determined latest version for ${dep.name}: ${versionToString(latest_version)} `);
                pkg_logger(dep).log(`Determined next version for ${dep.name}: ${versionToString(new_version)} `);
            }

            res({
                new_version: versionToString(new_version),
                git_version: versionToString(npm_version),
                pkg_version: versionToString(pkg_version),
                latest_version: versionToString(latest_version),
                NEW_VERSION_REQUIRED: commit_drift > 0
            });
        });
    });
}


export function getChangeLog(dep: Dependency) {

    let logs = [];

    for (const commit of dep.commits) {
        if (commit.message.match(/#changelog\s*$/gmi)) {
            logs.push(commit);
        }
    }

    pkg_logger(dep).log(`Building new logs for CHANGELOG.md`);

    return logs.map(log => {
        const BREAKING = !!log.message.match(/^\#?[Bb]reak(ing)?/g);

        const message = log.message.split(/#changelog\s*$/gmi)[1].split("\n").slice(1).map(m => m.trim()).join(" ").trim();

        return `- [${createISODateString(log.date)}]${BREAKING ? " **breaking change** " : ""}\n\n    ${message}`;
    });
}

function Commit_Is_Top_Of_Prev_Version(commit: CommitLog, dep: Dependency) {
    return commit.message.includes(dep.name) && commit.message.includes(dep.current_version + "");
}

function createISODateString(date: string = new Date + "") {
    const date_obj = new Date(date).toISOString();
    const date_string = date_obj + "";
    return date_string.split("T")[0];
}

function getLatestVersion(...versions: Version[]) {
    return versions.sort((a, b) => {
        if (a.sym[0] > b.sym[0])
            return -1;
        if (a.sym[0] < b.sym[0])
            return 1;
        if (a.sym[1] > b.sym[1])
            return -1;
        if (a.sym[1] < b.sym[1])
            return 1;
        if (a.sym[2] > b.sym[2])
            return -1;
        if (a.sym[2] < b.sym[2])
            return 1;

        if (channel_hierarchy[a.channel] > channel_hierarchy[b.channel])
            return -1;
        else if (channel_hierarchy[a.channel] < channel_hierarchy[b.channel])
            return 1;

        return 0;
    })[0];
}



function versionToString(
    new_version: Version,
    release_channel: string = new_version.channel
) {
    return (new_version.sym.join(".") + (release_channel ? "-" + release_channel : "")).toString();
}

function parseVersion(original_version: string) {

    const [version, channel] = (original_version).split("-");
    let new_version = version.split(".").map(i => parseInt(i));


    return {
        sym: new_version,
        channel
    };
}

export function getCandleLibraryDependNames(pkg: DevPkg) {
    return Object.getOwnPropertyNames(pkg?.dependencies).filter(name => name.includes("@candlelib"));
}

function pkg_logger(dep: Dependency) {
    return dev_logger.get(dep.package.name);
}

export async function validateDepend(dep: Dependency) {

    if (dep.DIRTY_REPO) {

        const status = gitStatus(dep.package._workspace_location, dep.package._workspace_location)
            .split("\n")
            .map(
                s => s
                    .replace(/M/g, xtF(xtColor(col_css.red)) + "M" + xtF(xtReset))
                    .replace(/^\?\?/g, xtF(xtColor(col_css.green)) + "??" + xtF(xtReset))
            ).join("\n");

        pkg_logger(dep).warn(`package has uncommitted changes and cannot be versioned: \n${status}`);

        return false;
    }

    pkg_logger(dep).log(`Running tests`);

    if (!await testPackage(dep.package)) {

        dep.TEST_STATUS = TestStatus.FAILED;

        pkg_logger(dep).warn(`package has failed tests`);

        return false;
    }

    pkg_logger(dep).log(`package tests completed.`);

    dep.TEST_STATUS = TestStatus.PASSED;

    return true;
}



async function createPublishBounty(pkg: DevPkg, dep: Dependency) {

    await fsp.writeFile(path.resolve(pkg._workspace_location, "publish.bounty"),
        `#! /bin/bash  

cd $(dirname "$0")

# Update changelog
touch ./change_log_addition.md
echo -n "$( cat ./CHANGELOG.md || '' )" >> ./change_log_addition.md
mv -f ./change_log_addition.md ./CHANGELOG.md

# Update package.json
if test -f ./package.temp.json; then
    touch ./package.temp.json
    mv -f ./package.temp.json ./package.json
fi

npm publish --access public

rm ./publish.bounty
`, { mode: 0o777 });
}

async function createCommitBounty(pkg: DevPkg, dep: Dependency) {

    const logs = getChangeLog(dep);

    if (logs.length > 0) {
        //append to change log

        const
            change_log_entry = `## [v${dep.version_data.new_version}] - ${createISODateString()} \n\n` + logs.join("\n\n");

        await fsp.writeFile(path.resolve(pkg._workspace_location, "change_log_addition.md"), change_log_entry + "\n\n");
    }

    const version = dep.version_data.new_version;

    const change_log = getChangeLog(dep);
    const cl_data = change_log.join("\n");

    await fsp.writeFile(path.resolve(pkg._workspace_location, "commit.bounty"),
        `#! /bin/bash 

cd $(dirname "$0")

# Update changelog
touch ./change_log_addition.md
echo -n "$( cat ./CHANGELOG.md || '' )" >> ./change_log_addition.md
mv -f ./change_log_addition.md ./CHANGELOG.md

# Update package.json
if test -f ./package.temp.json; then
    touch ./package.temp.json
    mv -f ./package.temp.json ./package.json
fi

git add ./

git reset ./commit.bounty ./publish.bounty ./change_log_addition.md
        
# git commit -m "version ${dep.name} to ${version}"
# 
rm ./commit.bounty
`, { mode: 0o777 });
}


function getCurrCommit() {
    return execSync(`git rev-list HEAD^!`).toString().trim();
}

async function createPublishVersionBountyHunter(
    ...bounty_paths: Dependency[]
) {
    await fsp.writeFile(URI.resolveRelative("./root.publish.bounty") + "",
        `#! /bin/bash
${bounty_paths.map((p, i) => `bounty_paths[${i}]="${p.package._workspace_location}/publish.bounty"`).join("\n")}

for script in \${bounty_paths[@]}; do
    if test -f $script; then  
        $script
    fi
done
`, { mode: 0o777 });
}

async function createCommitVersionBountyHunter(
    curr_commit: string,
    prev_commit: string,
    ...bounty_paths: Dependency[]
) {
    await fsp.writeFile(URI.resolveRelative("./root.commit.bounty") + "",
        `#! /bin/bash

CURR_COMMIT="${curr_commit}"
PREV_COMMIT="${prev_commit}"

# Move to staged version branch

git switch $STAGED_VERSION_BRANCH

# Merge Changes

git merge --squash -X theirs $CURR_COMMIT

LAST_VER_LOG=$(echo $(git --no-pager log --no-decorate HEAD^! ))

export LAST_VER_LOG

LAST_VER_DIGITS=$(node -e "console.log(process.env.LAST_VER_LOG.match(/Version\\s*(\\d+)/)[1])")

echo "Last Version $LAST_VER_DIGITS origin commit: $PREV_COMMIT"

# Collect Commit Bounties 

${bounty_paths.map((p, i) => `bounty_paths[${i}]="${p.package._workspace_location}/commit.bounty"`).join("\n")}

for script in \${bounty_paths[@]}; do
    if test -f $script; then  
        $script
    fi
done

VER_PLUS=$(expr $LAST_VER_DIGITS + 1)

# Perform stage commit 

git commit -m "Project Version $VER_PLUS

${bounty_paths.map((p, i) => `${p.name} @v${p.version_data.new_version}`).join("\n")}

origin:$CURR_COMMIT"
`, { mode: 0o777 });
}
/**
 * Create a new git branch with the name specified in STAGED_VERSION_BRANCH
 * and register the initial root commit of the branch with the root 
 * commit of the current repo.
 * @returns 
 */

function createStagedVersionBranch() {

    const branch = process.env.STAGED_VERSION_BRANCH;
    dev_logger.log(`Creating branch ${branch}`);
    return execSync(`
CURR_BRANCH=$(git rev-parse HEAD) > /dev/null

git checkout --track $VER_REMOTE_REPO/$STAGED_VERSION_BRANCH -B $STAGED_VERSION_BRANCH > /dev/null
    
ROOT_COMMIT="$( git rev-list --max-parents=0 HEAD )"

git commit --allow-empty -m "Project Version 0 \n\norigin:$ROOT_COMMIT" > /dev/null

git checkout $CURR_BRANCH > /dev/null

echo $ROOT_COMMIT`).toString().trim();
}

function getLastTrackedCommit() {
    return execSync(`
git reset --hard > /dev/null 2>&1

CURR_BRANCH=$(git rev-parse HEAD) > /dev/null 2>&1

git checkout --track $VER_REMOTE_REPO/$STAGED_VERSION_BRANCH -B $STAGED_VERSION_BRANCH > /dev/null 2>&1

LAST_VER_LOG=$(echo $(git --no-pager log --no-decorate HEAD^! )) > /dev/null 2>&1

export LAST_VER_LOG

LAST_VER_ORIGIN=$(node -e "console.log(process.env.LAST_VER_LOG.match(/origin:\\s*(.+)/)?.[1] ?? \\"\\")")

git checkout $CURR_BRANCH > /dev/null 2>&1

echo $LAST_VER_ORIGIN
`, ).toString().trim();
}
export async function validateEligibilityPackages(
    /**
     * An array of package names of which the system
     * should version. 
     */
    packages: string[],
    getDependencyNames: (arg: DevPkg) => string[],
    DRY_RUN: boolean = false,
): Promise<boolean> {

    let prev_origin_commit = "";
    let curr_origin_commit = getCurrCommit();

    // Ensure there is a staging branch for version commits
    // if there is not, throw error and exit. 
    if (!process.env.STAGED_VERSION_BRANCH) {
        dev_logger.warn("The environment variable STAGED_VERSION_BRANCH must be set to enable the version system");
        process.exit();
    } else {
        prev_origin_commit = getLastTrackedCommit();
        if (!prev_origin_commit) {
            prev_origin_commit = createStagedVersionBranch();
            if (!prev_origin_commit) {
                dev_logger.warn("Unable to create a staged commit branch");
                return false;
            }
        }
    }

    const target_packages = await Promise.all(packages.map(str => createDepend(str, prev_origin_commit)));
    const dependencies: Dependencies = new Map(target_packages.map(p => [p.name, p]));

    let processed: Set<Dependency> = new Set();

    const updated: Set<Dependency> = new Set();
    for (const depend_set of await Promise.all(target_packages.map(pkg => validateEligibility(prev_origin_commit, pkg, getDependencyNames, DRY_RUN, dependencies)))) {

        for (const dep of depend_set) {

            if (processed.has(dep))
                continue;

            processed.add(dep);

            // Update the package version
            const pkg = dep.package;

            for (const key in pkg?.dependencies ?? {})
                if (dependencies.has(key)) {
                    const dep = dependencies.get(key);


                    pkg.dependencies[key] = dep.version_data.NEW_VERSION_REQUIRED
                        ? dep.version_data.new_version
                        : dep.version_data.latest_version;
                }

            const logger = pkg_logger(dep);

            if (dep.version_data.NEW_VERSION_REQUIRED) {

                updated.add(dep);

                logger.log(`Updating ${dep.name}`);

                pkg.version = dep.version_data.new_version;

                const json = JSON.stringify(Object.assign({}, pkg, { _workspace_location: undefined }), null, 4);

                logger.log(`Updating package.json to v${dep.version_data.new_version}`);
                if (!DRY_RUN) await fsp.writeFile(path.resolve(pkg._workspace_location, "package.temp.json"), json);

                logger.log(`Creating A commit.bounty for ${dep.name}@${dep.version_data.new_version}`);
                if (!DRY_RUN) await createPublishBounty(pkg, dep);;

                logger.log(`Creating a publish.bounty for ${dep.name}@${dep.version_data.new_version}`);
                if (!DRY_RUN) await createCommitBounty(pkg, dep);
            } else
                dev_logger.log(`No version change required for ${dep.name} at v${dep.version_data.latest_version}`);
        }
    }

    if (updated.size > 0) {
        await createCommitVersionBountyHunter(curr_origin_commit, prev_origin_commit, ...updated);
        await createPublishVersionBountyHunter(...updated);
    }

    return true;
}

export async function validateEligibility(
    prev_tracked_commit: string,
    primary_repo: Dependency,
    /**
     * A function that returns a list of package names
     * that should be considered for versioning. 
     */
    getDependencyNames: (arg: DevPkg) => string[],
    DRY_RUN: boolean = false,
    global_packages: Dependencies = new Map([[primary_repo.name, primary_repo]])
) {

    if (primary_repo.PROCESSED)
        return;

    primary_repo.PROCESSED = true;

    //Test each dependency to ensure full compatibility

    let CAN_VERSION = true;

    let iter = await getPackageDependenciesGen(prev_tracked_commit, primary_repo, getDependencyNames, global_packages);

    let val = await iter.next();

    while (val.done == false) {

        const { dep, dependencies } = val.value;

        if (!(await validateDepend(dep)))
            CAN_VERSION = false;

        val = await iter.next();
    }

    const dependencies = val.value;

    if (CAN_VERSION || DRY_RUN) {

        // All tests passed means we can update the version of any 
        // package that has changed, or has changed dependencies
        let CHANGES = true;

        // This loop ensures all packages get updated with correct 
        // dependency versions, even if there are  cycles in the 
        // dependency graph.
        while (CHANGES) {

            CHANGES = false;

            for (const dep of dependencies.values()) {

                if (dep.PROCESSED && dep != primary_repo)
                    continue;

                for (const key in dep.package?.dependencies ?? {}) {
                    if (dependencies.has(key)) {
                        const val = parseVersion(dep.package.dependencies[key]);
                        const depend = dependencies.get(key);

                        if (
                            (depend.version_data.NEW_VERSION_REQUIRED
                                &&
                                !dep.version_data.NEW_VERSION_REQUIRED)
                            ||
                            depend.version_data.latest_version
                            != versionToString(val)
                        ) {
                            dep.version_data.NEW_VERSION_REQUIRED = true;
                            const version = parseVersion(dep.version_data.latest_version);
                            version.sym[2]++;
                            dep.version_data.new_version = versionToString(version);
                            dep.package.dependencies[key] = depend.version_data.latest_version;
                            CHANGES = true;
                        }
                    }
                }
            }
        }

        return dependencies.values();
    }

    else dev_logger.warn(`Could not version ${primary_repo.name} due to the proceeding error(s).`);

    throw new Error("Cannot Version");
}
