#! /bin/node

import {
    addCLIConfig, getPackageJsonObject, processCLIConfig
} from "@candlelib/paraffin";
import URI from "@candlelib/uri";
import { Logger } from "@candlelib/log";
import { createDepend, getPackageData, validateEligibility, validateEligibilityPackages, getCandleLibraryDependNames } from "../utils/version-sys.js";
import fs from "fs";
const dev_logger = Logger.get("dev-tools").activate();

import { gitClone, gitCheckout } from "../utils/git.js";


const fsp = fs.promises;

const { package: pkg, package_dir: dev_dir } = await getPackageJsonObject(URI.getEXEURL(import.meta).path);

await URI.server();

addCLIConfig({
    key: "root",
    help_brief: `CandleLibrary::Dev-Tools v${pkg.version}`,
});

//Versioning CLI Arguments
const channel = addCLIConfig("version", {
    key: "channel",
    REQUIRES_VALUE: false,
    accepted_values: ["release", "beta", "experimental"],
    validate: (val) => {
        if (!["release", "beta", "experimental"].includes(val)) {
            return `Expected value that matched one of these options:\n- release\n- beta\n- experimental`;
        }
        return "";
    },
    help_brief: `

The release channel the version should increment to. By default the version 
is incremented from the most recent version assignment, but a channel can 
be specified to cause the version to increment INTO the specified channel.`
});

const dry_run = addCLIConfig("version", {
    key: "dryrun",
    REQUIRES_VALUE: false,
    help_brief: `
Only report what would be changed, do not make any permanent changes.`
});


addCLIConfig("version", {
    key: "version",
    help_brief: ` 

usage: version [candle-lib-package-names]*

Increments the version of the Candle Library package based on the 
the changes made in the package's git repo since the last version
and on changes made in any of the dependencies that are also 
Candle Library packages. If any changes have been made in the 
dependency packages, then their package version will be incremented
as well, and the dependency specification in the package.json will
be updated to reflect the dependency's new version. 

This command will not work if any of the affected Candle Library
packages have uncommitted changes, or if any of the affected packages
have failing tests. 

This command must be run in the root directory of a Candle Library
package, additionally, this command will only work with Candle Library 
packages.`,
}).callback = (async (arg, args) => {

    const DRY_RUN = !!dry_run.value;

    const names = args.trailing_arguments;

    if (DRY_RUN)
        dev_logger.log("\nDry Run: No changes will be recorded.\n");


    if (names.length > 0) {
        const packages = await Promise.all(names.map(name => createDepend("@candlelib/" + name)));

        await validateEligibilityPackages(packages.filter(p => !!p), getCandleLibraryDependNames, DRY_RUN);
        /*  for (const name of names) {
 
 
             try {
 
                 const dep = await ;
 
                 await validateEligibility(dep, getCandleLibraryDependNames, DRY_RUN);
             } catch (e) {
                 dev_logger.log(`Could not version package with name ${name}. Is this a Candle Library package?`);
             }
         } */
    } else {

        const { FOUND, package: pkg, package_dir } = await getPackageJsonObject();

        if (FOUND && package_dir == process.cwd() + "/") {
            // Attempt to version the package that is located 
            // at CWD

            const pk = await getPackageData(pkg.name.replace("@candlelib/", process.cwd() + "/../"));

            const dep = await createDepend(pk);

            await validateEligibility(dep, DRY_RUN);
        }
    }
});

const vscode_workspace = addCLIConfig("install-workspace", {
    key: "vscode",
    REQUIRES_VALUE: false,
    help_brief: `
Create a Visual Studio Code workspace file at the root of the workspace directory`
});

addCLIConfig("install-workspace", {
    key: "install-workspace",
    help_brief: ` 

usage: install-workspace <workspace-path>

Create a CandleLibrary workspace at <workspace-path> and
set the default workspace to this location. Once the workspace
directory is created all Candle Library repositories are cloned
into the workspace, and appropriate links are created to resolve 
module imports.`,
}).callback = (async (arg, args) => {

    const candlelib_repo_names = Object.keys(pkg.devDependencies);

    const package_dir = args.trailing_arguments.slice(-1)[0];

    if (package_dir) {

        let uri = new URI(package_dir);

        if (uri.IS_RELATIVE) {
            uri = URI.resolveRelative(uri);
        }

        dev_logger.log(`Creating new Candle Library workspace at ${uri}`);

        try { fsp.mkdir(uri + "", { recursive: true }); } catch (e) {
            dev_logger.log("Unable to create directory. Exiting");
            process.exit(-1);
        }

        dev_logger.log("Directory Created. Cloning repos:\n\n");


        // .filter(s => s.includes("@candlelib"))
        // .map(s => s.replace("@candlelib/", ""));
        //
        for (const repo of candlelib_repo_names) {
            if (!gitClone(pkg["candle-env"]["repo-root"] + "/" + repo, uri + ""))
                dev_logger.log(`Error loading ${repo}`);
            else {
                dev_logger.log("Cloned " + repo + "\n\n");
                if (!gitCheckout(uri + "/" + repo, "dev"))
                    dev_logger.log("Could not checkout dev branch of " + repo);
            }

            dev_logger.log("-----------\n\n");
        }

        dev_logger.log("Creating links");

        try { await fsp.mkdir(uri + "/node_modules/@candlelib", { recursive: true }); } catch (e) {
            dev_logger.log("Unable to link repositories");
        }

        for (const repo of candlelib_repo_names) {
            try {
                fs.symlinkSync(uri + "/" + repo, uri + "/node_modules/@candlelib/" + repo);
                dev_logger.log(`+ ${repo}`);
            } catch (e) {
                //dev_logger.log(e);
                dev_logger.log(`- ${repo}`);
            }
        }

        if (vscode_workspace.value) {

            dev_logger.log("Creating VSCode Workspace file");

            const JSON_OBJ = { folders: [] };

            for (const name of candlelib_repo_names) {

                const pkg = await getPackageData(name);

                const simple_name = name.replace("@candlelib/", "");
                if (pkg) {


                    JSON_OBJ.folders.push({
                        name: pkg.description ? simple_name + ": " + pkg.description : simple_name,
                        path: "./" + simple_name
                    });

                } else {
                    console.warn(`Could not open package.json for ${simple_name}`);
                }
            }

            await fsp.writeFile(uri + "/candle_lib.code-workspace", JSON.stringify(JSON_OBJ));
            dev_logger.log("VSCode Workspace file written");
        }

        await fsp.writeFile(dev_dir + "CANDLE_ENV", `WORKSPACE_DIR=${uri + ""}`);
    }
});



addCLIConfig("publish", {
    key: "publish",
    help_brief: ` 

usage: publish

Publishes any Candle Library package that has a publish.bounty file.`,
}).callback = (async (arg, args) => {

    const candlelib_repo_names = Object.keys(pkg["candle-lib-modules"]);
    const cp = (await import("child_process")).default;

    for (const name of candlelib_repo_names) {

        const dep = await getPackageData(name);

        if (dep) {


            try {

                cp.execFileSync(dep._workspace_location + "/publish.bounty", {
                    cwd: dep._workspace_location,
                });
                dev_logger.log(`Published ${name}`);
            } catch (e) {
                dev_logger.log(`No publish bounty for ${name}`);
            }
        }
    }
});
try {
    processCLIConfig("candle.dev");
} catch (e) {
    dev_logger.log(e);
    process.exit(-1);
}