import { getPackageJsonObject, xtColor, col_css, xtReset, xtF } from "@candlelib/paraffin";
import child_process from "child_process";
import fs from "fs";
import path from "path";
import { gitStatus, gitLog, gitAdd, gitCommit, gitTag } from "./git.js";
import { Dependency, Dependencies, CommitLog, TestStatus, DevPkg, Version } from "../types/types";
import URL from "@candlelib/uri";

const fsp = fs.promises;



const channel_hierarchy = {
    "": 100000,
    "release": 50000,
    "beta": 25000,
    "alpha": 12500,
    "experimental": 6250,
};

/**
 * Default workspace directory
 */
const WORKSPACE_DIR: string = (await getWorkspaceEnvironmentVar())?.WORKSPACE_DIR ?? "";

/**
 * Retrieves the CANDLE_ENV file* , parses it, and returns
 * a key:value object representing the environment variables
 * contained in the file.
 * 
 * *located in the root of the dev-tools repo after installation 
 * 
 * @returns Promise<Object>
 */
export async function getWorkspaceEnvironmentVar(): Promise<{
    [env_var: string]: string;
}> {
    try {
        await URL.server();

        const env_file = await fsp.readFile(
            path.resolve(URL.getEXEURL(import.meta) + "", "../../../../CANDLE_ENV"),
            { encoding: "utf8" }
        );

        if (!env_file)
            return null;
        return Object.fromEntries(env_file.split("\n").filter(n => !!n).map(str => str.split("=", 2)));

    } catch (e) {
        console.error(e);
        return null;
    }
}



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
export async function getCandlePackage(candle_lib_name: string, ws_dir: string = WORKSPACE_DIR):
    Promise<DevPkg> {

    if (candle_lib_name.includes("@candlelib/"))
        candle_lib_name = candle_lib_name.replace(/\@candlelib\//g, "");

    const
        candle_path = path.resolve(ws_dir, candle_lib_name),
        { package: pkg, FOUND } = await getPackageJsonObject(candle_path + "/");

    if (FOUND && pkg && pkg.name.includes("@candlelib/")) {
        pkg._workspace_location = candle_path;
        return <any>pkg;
    }

    return null;
}

/**
 * Runs the testing system in a new process for the givin project
 */
export async function testPackage(pkg: DevPkg): Promise<boolean> {

    const CWD = pkg._workspace_location;

    const test = pkg.scripts.test;

    let process = null;

    try {

        process = child_process.execSync(test, {
            cwd: CWD, stdio: ["pipe", "pipe", "pipe"]
        });

        return true;
    } catch (e) {
        console.error(e.stack);
        //console.log(e.stdout.toString());
        //console.error(e.stderr.toString());
    }

    return false;
}


/**
 * Retrieves a list of direct and indirect candlelib dependencies of the specified module
 * @param package_name 
 * @param dependencies 
 * @returns 
 */
export async function* getPackageDependenciesGen(dep: Dependency, dependencies: Dependencies = new Map(
    [[dep.name, dep]]

)): AsyncGenerator<{ dep: Dependency, dependencies: Dependencies; }, Dependencies> {

    if (!dep)
        throw new Error("pkg argument is undefined");

    if (dep.package?.dependencies) {

        const cl_depends = getCandleLibraryDependNames(dep.package);

        for (const dependent_name of cl_depends) {

            if (!dependencies.has(dependent_name)) {

                const dep_pkg = await getCandlePackage(dependent_name);

                if (dep_pkg) {

                    log(`Get dependency ${dependent_name}`);

                    const dep = await createDepend(dep_pkg);

                    dependencies.set(dependent_name, dep);

                    dependencies.get(dependent_name).reference_count++;

                    yield* (await getPackageDependenciesGen(dep, dependencies));


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

export async function getPackageDependencies(dep: Dependency) {
    const iter = await getPackageDependenciesGen(dep);
    let val = null;
    while ((val = (await iter.next())).done == false);

    return val.value;
}

export async function createDepend(dep_pkg: string | DevPkg): Promise<Dependency> {

    if (typeof dep_pkg == "string")
        dep_pkg = await getCandlePackage(dep_pkg);

    if (dep_pkg) {

        const CWD = dep_pkg._workspace_location;
        const commit_string = gitLog(CWD);
        const commits: CommitLog[] = <any>commit_string
            .split(/^\s*commit\s*/mg)
            .map(str => str.match(/^(?<hash>.*)$\s*author\s*\:(?<author>.*)$\s*date\s*\:(?<date>.*)$(?<message>(.|\.|[\n\s\r])+)/mi)?.groups)
            //.map(g => { if (g) { const [head, body] = g.message.split(/\n/g); g.head = head + ""; g.body = body + ""; } return g; })
            .map(g => { if (g) for (const name in g) g[name] = g[name].trim(); return g; })
            .filter(m => !!m);

        const DIRTY_REPO = gitStatus(dep_pkg._workspace_location).length > 0;
        const dep = {
            name: dep_pkg.name,
            package: dep_pkg,
            TEST_STATUS: TestStatus.NOT_RUN,
            reference_count: 0,
            new_version: "",
            commits,
            DIRTY_REPO,
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
        if (commit.message.match(/^version |^\v\d+/g)) {
            git_version_string = commit.message.replace("version ", "").trim();
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

    log(`Determined latest version for ${dep.name}: ${versionToString(latest_version)}`);

    return {
        new_version: versionToString(new_version),
        git_version: versionToString(git_version),
        pkg_version: versionToString(pkg_version),
        latest_version: versionToString(latest_version),
        NEW_VERSION_REQUIRED: commit_drift > 0
    };
}


export function getChangeLog(dep: Dependency, release_channel = "", RELEASE = false) {

    let logs = [];

    for (const commit of dep.commits) {
        if (commit.message.match(/^version |^\v\d+/g)) {
            break;
        } else if (commit.message.match(/#changelog\s*$/gm)) {
            logs.push(commit);
        }
    }

    log(`Building change log for ${dep.name}`);

    return logs.map(log => {
        const BREAKING = !!log.message.match(/^\#?[Bb]reak(ing)?/g);

        const message = log.message.split(/#changelog\s*$/gm)[1].split("\n").slice(1).map(m => m.trim()).join(" ").trim();

        return `- [${createISODateString(log.date)}]${BREAKING ? " **breaking change** " : ""}\n\n    ${message}`;
    });
}

function createISODateString(date: string = new Date + "") {
    const date_obj = new Date(date).toISOString();
    const date_string = date_obj + "";
    return date_string.split("T")[0];
}

function createISODateTimeString(date: string = new Date + "") {
    const date_obj = new Date(date).toISOString();
    const date_string = date_obj + "";
    return date_string;
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

function getCandleLibraryDependNames(pkg: DevPkg) {
    return Object.getOwnPropertyNames(pkg?.dependencies).filter(name => name.includes("@candlelib"));
}

export async function validateDepend(dep: Dependency) {

    if (dep.DIRTY_REPO) {

        const status = gitStatus(dep.package._workspace_location)
            .split("\n")
            .map(
                s => s
                    .replace(/M/g, xtF(xtColor(col_css.red)) + "M" + xtF(xtReset))
                    .replace(/^\?\?/g, xtF(xtColor(col_css.green)) + "??" + xtF(xtReset))
            ).join("\n");

        log(`\n${dep.name} has uncommitted changes and cannot be versioned: \n${status}`);

        return false;
    }
    log(`Running tests for ${dep.name}`);

    if (!await testPackage(dep.package)) {

        dep.TEST_STATUS = TestStatus.FAILED;

        log(`${dep.name} has failed testing`);

        return false;
    }

    log(`${dep.name} tests completed.`);

    dep.TEST_STATUS = TestStatus.PASSED;

    return true;
}

export async function validateEligibility(primary_repo: Dependency, DRY_RUN: boolean = false) {

    //Test each dependency to ensure full compatibility

    let CAN_VERSION = true;

    let iter = await getPackageDependenciesGen(primary_repo);

    let val = await iter.next();

    while (val.done == false) {

        const { dep, dependencies } = val.value;

        if (!(await validateDepend(dep)))
            CAN_VERSION = false;
        else {
            for (const key in dep.package?.dependencies ?? {})
                if (dependencies.has(key)) {
                    const depend = dependencies.get(key);

                    if (
                        depend.version_data.NEW_VERSION_REQUIRED
                        &&
                        !dep.version_data.NEW_VERSION_REQUIRED
                    ) {
                        dep.version_data.NEW_VERSION_REQUIRED = true;
                        const version = parseVersion(dep.version_data.latest_version);
                        version.sym[2]++;
                        dep.version_data.new_version = versionToString(version);
                    }
                }
        }

        val = await iter.next();
    }

    const dependencies = val.value;


    if (CAN_VERSION || DRY_RUN)

        // All tests passed means we can update the version of any 
        // package that has changed, or has changed dependencies

        for (const dep of dependencies.values()) {

            // Update the package version
            const pkg = dep.package;

            for (const key in pkg?.dependencies ?? {})
                if (dependencies.has(key)) {
                    const dep = dependencies.get(key);


                    pkg.dependencies[key] = dep.version_data.NEW_VERSION_REQUIRED
                        ? dep.version_data.new_version
                        : dep.version_data.latest_version;
                }

            if (dep.version_data.NEW_VERSION_REQUIRED) {

                log(`\nUpdating ${dep.name}\n`);

                const logs = getChangeLog(dep);

                if (logs.length > 0) {
                    //append to change log

                    const
                        change_log_entry = `## [v${dep.version_data.new_version}] - ${createISODateString()} \n\n` + logs.join("\n\n"),

                        cwd = dep.package._workspace_location,

                        change_log_path = path.resolve(cwd, "CHANGELOG.md");

                    let file = "";

                    try {
                        file = await fsp.readFile(change_log_path, { encoding: "utf8" });
                    } catch (e) { }

                    if (!file) {
                        file = `## [v${dep.version_data.latest_version}] \n\n- No changes recorded prior to this version.`;
                    }

                    log(`Adding ${logs.length} new CHANGELOG entr${logs.length > 1 ? "ies" : "y"}:\n`);

                    log(logs.join("\n\n"), "\n");

                    if (!DRY_RUN)

                        await fsp.writeFile(change_log_path, change_log_entry + "\n\n" + file);
                }

                pkg.version = dep.version_data.new_version;

                const json = JSON.stringify(Object.assign({}, pkg, { _workspace_location: undefined }), null, 4);

                if (!DRY_RUN)
                    await fsp.writeFile(path.resolve(pkg._workspace_location, "package.json"), json);

                log(`Updating package.json to v${dep.version_data.new_version}`);

                if (!DRY_RUN)
                    gitAdd(dep.package._workspace_location);

                log(`Creating commit for ${dep.name}@${dep.version_data.new_version}`);

                if (!DRY_RUN)
                    gitCommit(dep.package._workspace_location, `version ${dep.version_data.new_version}`);

                log(`Creating tag for ${dep.name}@${dep.version_data.new_version}`);
                if (!DRY_RUN)
                    gitTag(dep.package._workspace_location, `v${dep.version_data.new_version}`);

                log(`Creating publish bounty for ${dep.name}@${dep.version_data.new_version}`);
                if (!DRY_RUN) {
                    await fsp.writeFile(path.resolve(pkg._workspace_location, "publish.bounty"), `#! /bin/bash \n yarn publish --new-version ${dep.version_data.new_version} \n rm ./publish.bounty`, {
                        mode: 0o777
                    });
                }

            } else

                log(`No version change required for ${dep.name} at v${dep.version_data.latest_version}`);

        }

    else log(`Could not version ${primary_repo.name} due to the proceeding error(s).`);

    log("\n");

}

function log(...msgs: any[]): void {
    console.log(...msgs);
}