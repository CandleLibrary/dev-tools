import { Logger } from "@candlelib/log";
import { col_css, getPackageJsonObject, xtColor, xtF, xtReset } from "@candlelib/paraffin";
import URI from '@candlelib/uri';
import child_process from "child_process";
import fs from "fs";
import path from "path";
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
export async function getCandlePackage(candle_lib_name: string):
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

                const dep_pkg = await getCandlePackage(dependent_name);

                if (dep_pkg) {

                    dev_logger.log(`Get dependency ${dependent_name}`);

                    const dep = await createDepend(dep_pkg);

                    dependencies.set(dependent_name, dep);

                    dependencies.get(dependent_name).reference_count++;

                    yield* (await getPackageDependenciesGen(dep, getDependencyNames, dependencies));


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

export async function createDepend(dep_pkg: string | DevPkg): Promise<Dependency> {

    if (typeof dep_pkg == "string")
        dep_pkg = await getCandlePackage(dep_pkg);

    if (dep_pkg) {

        const CWD = dep_pkg._workspace_location;
        const commit_string = gitLog(CWD, dep_pkg._workspace_location);

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
export async function getNewVersionNumber(dep: Dependency, release_channel = "", RELEASE = false) {
    const pkg_version = parseVersion(dep.package.version);
    //Traverse commits and attempt to find version commits
    let git_version_string = "0.0.0-experimental";

    let BREAKING = false, FEATURE = false, commit_drift = 0;

    for (const commit of dep.commits) {
        if (Commit_Is_Top_Of_Prev_Version(commit, dep)) {
            git_version_string = commit.message.match(/^.*(\d+\.\d+\.\d+\w*)/)[1].trim();
            break;
        } else if (!BREAKING && commit.message.match(/^\#?[Bb]reak(ing)?/g)) {
            BREAKING = true;
        } else if (!FEATURE && commit.message.match(/^\#?[Ff]eat(ure)?/g)) {
            FEATURE = true;
        }
        commit_drift++;
    }

    const git_version = parseVersion(git_version_string);

    const latest_version = getLatestVersion(pkg_version, git_version);

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

    return {
        new_version: versionToString(new_version),
        git_version: versionToString(git_version),
        pkg_version: versionToString(pkg_version),
        latest_version: versionToString(latest_version),
        NEW_VERSION_REQUIRED: commit_drift > 0
    };
}


export function getChangeLog(dep: Dependency) {

    let logs = [];

    for (const commit of dep.commits) {

        if (Commit_Is_Top_Of_Prev_Version(commit, dep)) {
            break;
        } else if (commit.message.match(/#changelog\s*$/gmi)) {
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
    return new_version.sym.join(".") + (release_channel ? "-" + release_channel : "");
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

export async function validateEligibilityPackages(
    packages: Dependency[],
    getDependencyNames: (arg: DevPkg) => string[],
    DRY_RUN: boolean = false,
) {

    const dependencies = new Map(packages.map(p => [p.name, p]));

    let processed = new WeakSet();
    for (const depend_set of await Promise.all(packages.map(pkg => validateEligibility(pkg, getDependencyNames, DRY_RUN, dependencies)))) {

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

                logger.log(`Updating ${dep.name}`);

                pkg.version = dep.version_data.new_version;

                const json = JSON.stringify(Object.assign({}, pkg, { _workspace_location: undefined }), null, 4);

                logger.log(`Updating package.json to v${dep.version_data.new_version}`);
                if (!DRY_RUN) await fsp.writeFile(path.resolve(pkg._workspace_location, "package.json"), json);

                logger.log(`Creating A commit.bounty for ${dep.name}@${dep.version_data.new_version}`);
                if (!DRY_RUN) await createPublishBounty(pkg, dep);;

                logger.log(`Creating a publish.bounty for ${dep.name}@${dep.version_data.new_version}`);
                if (!DRY_RUN) await createCommitBounty(pkg, dep);
            } else
                //logger.log(`No version change required for ${dep.name} at v${dep.version_data.latest_version}`);
                ;

        }
    }

    new Set();
}

async function createPublishBounty(pkg: DevPkg, dep: Dependency) {

    await fsp.writeFile(path.resolve(pkg._workspace_location, "publish.bounty"),
        `#! /bin/sh 

yarn publish --new-version ${dep.version_data.new_version}  

rm ./publish.bounty
`, {
        mode: 0o777
    });
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
        `#! /bin/sh 

touch ./change_log_addition.md

echo -n "$( cat ./CHANGELOG.md || '' )" >> ./change_log_addition.md

mv -f ./change_log_addition.md ./CHANGELOG.md

git add ./

git reset ./commit.bounty ./publish.bounty ./change_log_addition.md

git commit -m "version ${dep.name} to ${version}"

rm ./commit.bounty
`, {
        mode: 0o777
    });
}

export async function validateEligibility(
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

    let iter = await getPackageDependenciesGen(primary_repo, getDependencyNames, global_packages);

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
