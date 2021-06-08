#! /bin/node

import { getPackageJsonObject, getProcessArgs } from "@candlelib/wax";
import { createDepend, getCandlePackage, validateEligibility } from "../utils/version-sys.js";


const args = getProcessArgs({
    "version": false
});


if (args.version) {

    const { FOUND, package: pkg, package_dir } = await getPackageJsonObject();

    if (FOUND && package_dir == process.cwd() + "/") {

        const pk = await getCandlePackage(pkg.name.replace("@candlelib/", process.cwd() + "/../"));
        const dep = await createDepend(pk);
        await validateEligibility(dep);
    }
}