#! /bin/node

import {
    addCLIConfig, getPackageJsonObject, processCLIConfig
} from "@candlelib/paraffin";
import URL from "@candlelib/uri";
import { createDepend, getCandlePackage, validateEligibility } from "../utils/version-sys.js";

const { package: pkg } = await getPackageJsonObject(URL.getEXEURL(import.meta).path);

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

try {
    processCLIConfig();
} catch (e) {
    process.exit(-1);
}