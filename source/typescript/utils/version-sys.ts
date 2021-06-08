import { getPackageJsonObject, xtColor, col_css, xtReset, xtF } from "@candlelib/paraffin";
import child_process from "child_process";
import fs from "fs";
import path from "path";
import { gitStatus, gitLog, gitAdd, gitCommit } from "./git.js";
import { Dependency, Dependencies, CommitLog, TestStatus, DevPkg, Version } from "../types/types";

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
        const env_file = await fsp.readFile(
            path.resolve(process.cwd(), "CANDLE_ENV"),
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
        console.error(e);
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
        } else if (!BREAKING && commit.message.match(/\#?[Bb]reak(ing)?/g)) {
            BREAKING = true;
        } else if (!FEATURE && commit.message.match(/\#?[Fe]at(ure)?/g)) {
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

    return {
        new_version: versionToString(new_version),
        git_version: versionToString(git_version),
        pkg_version: versionToString(pkg_version),
        latest_version: versionToString(latest_version),
        NEW_VERSION_REQUIRED: commit_drift > 0
    };
}


export function getChangeLog(dep: Dependency, release_channel = "", RELEASE = false) {

    let log = [];

    for (const commit of dep.commits) {
        if (commit.message.match(/^version |^\v\d+/g)) {
            break;
        } else if (commit.message.match(/\#?changelog?/g)) {
            log.push(commit);
        }
    }

    return log.map(log => {
        const BREAKING = !!log.message.match(/\#?[Bb]reak(ing)?/g);


        const message = log.message.split("\n").slice(1).map(m => m.trim()).join(" ").replace(/\#?changelog?/g, "").trim();
        const date = new Date(log.date).toDateString();

        return `- [${date}]${BREAKING ? " **breaking change** " : ""}\n\n    ${message}`;
    });
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

export async function versionPackage() { }


export async function versionSysStart() {

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

    if (!await testPackage(dep.package)) {

        dep.TEST_STATUS = TestStatus.FAILED;

        log(`${dep.name} has failed testing`);

        return false;
    }

    dep.TEST_STATUS = TestStatus.PASSED;

    return true;
}

export async function validateEligibility(primary_repo: Dependency) {

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


    if (CAN_VERSION)

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

                const logs = getChangeLog(dep);

                if (logs.length > 0) {
                    //append to change log

                    const
                        change_log_entry = `## [v${dep.version_data.new_version}] \n\n` + logs.join("\n\n"),

                        cwd = dep.package._workspace_location,

                        change_log_path = path.resolve(cwd, "CHANGELOG.md");

                    let file = "";

                    try {
                        file = await fsp.readFile(change_log_path, { encoding: "utf8" });
                    } catch (e) { }

                    await fsp.writeFile(change_log_path, change_log_entry + "\n\n" + file);
                }

                pkg.version = dep.version_data.new_version;

                const json = JSON.stringify(Object.assign({}, pkg, { _workspace_location: undefined }), null, 4);

                await fsp.writeFile(path.resolve(pkg._workspace_location, "package.json"), json);

                log(`Updating ${dep.name} to v${dep.version_data.new_version}`);

                gitAdd(dep.package._workspace_location);

                gitCommit(dep.package._workspace_location, `version ${dep.version_data.new_version}`);

            } else

                log(`No version change required for ${dep.name} at v${dep.version_data.latest_version}`);

        }

    else log(`Could not version ${primary_repo.name} due to the proceeding error(s).`);

}

function log(...msgs: any[]): void {
    console.log(...msgs);
}