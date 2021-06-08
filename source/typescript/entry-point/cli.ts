#! /bin/node

import {
    addCLIConfig, getPackageJsonObject, processCLIConfig
} from "@candlelib/paraffin";
import URI from "@candlelib/uri";
import { createDepend, getCandlePackage, validateEligibility } from "../utils/version-sys.js";
import fs from "fs";
import { gitClone, gitCheckout } from "../utils/git.js";


const fsp = fs.promises;

const { package: pkg, package_dir: dev_dir } = await getPackageJsonObject(URI.getEXEURL(import.meta).path);

await URI.server();

addCLIConfig({
    key: "root",
    help_brief: ` 
CandleLibrary::Dev-Tools v${pkg.version}`,
});


const channel = addCLIConfig("version", {
    key: "channel",
    REQUIRES_VALUE: true,
    validate: (val) => {
        if (!["release", "beta", "experimental"].includes(val)) {
            return `Expected value that matched one of these options:\n- release\n- beta\n- experimental`;
        }
        return "";
    },
    help_brief: `
Accepted values: release | beta | experimental

The release channel the version should increment to. By default the version 
is incremented from the most recent version assignment, but a channel can 
be specified to cause the version to increment INTO the specified channel.`
});


//Versioning CLI Arguments
addCLIConfig("version", {
    key: "version",
    help_brief: ` 
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
}).callback = (async (args) => {
    const { FOUND, package: pkg, package_dir } = await getPackageJsonObject();

    if (FOUND && package_dir == process.cwd() + "/") {

        const pk = await getCandlePackage(pkg.name.replace("@candlelib/", process.cwd() + "/../"));
        const dep = await createDepend(pk);
        await validateEligibility(dep);
    }
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
}).callback = (async (args) => {

    const package_dir = args.trailing_arguments.slice(-1)[0];

    if (package_dir) {

        let uri = new URI(package_dir);

        if (uri.IS_RELATIVE) {
            uri = URI.resolveRelative(uri);
        }

        console.log(`Creating new Candle Library workspace at ${uri}`);

        try { fsp.mkdir(uri + "", { recursive: true }); } catch (e) {
            console.log("Unable to create directory. Exiting");
            process.exit(-1);
        }

        console.log("Directory Created. Cloning repos:\n\n");

        const candlelib_repo_names = Object.keys(pkg.devDependencies)
            .filter(s => s.includes("@candlelib"))
            .map(s => s.replace("@candlelib/", ""));

        for (const repo of candlelib_repo_names) {
            if (!gitClone(pkg["candle-env"]["repo-root"] + "/" + repo, uri + ""))
                console.log(`Error loading ${repo}`);
            else {
                console.log("Cloned " + repo + "\n\n");
                if (!gitCheckout(uri + "/" + repo, "dev"))
                    console.log("Could not checkout dev branch of " + repo);
            }

            console.log("-----------\n\n");
        }

        console.log("Creating links");

        try { await fsp.mkdir(uri + "/node_modules/@candlelib", { recursive: true }); } catch (e) {
            console.log("Unable to link repositories");
        }

        for (const repo of candlelib_repo_names) {
            try {
                fs.symlinkSync(uri + "/" + repo, uri + "/node_modules/@candlelib/" + repo);
                console.log(`+ ${repo}`);
            } catch (e) {
                //console.log(e);
                console.log(`- ${repo}`);
            }
        }

        await fsp.writeFile(dev_dir + "CANDLE_ENV", `WORKSPACE_DIR=${uri + ""}`);
    }
});

try {
    processCLIConfig();
} catch (e) {
    console.log(e);
    process.exit(-1);
}