#! /usr/bin/node

// Versions each package and updates dependencies to current versions

// All packages that should be versioned 

import { getPackageJsonObject } from "@candlelib/paraffin";
import URL from "@candlelib/uri";
import fs from "fs";
const fsp = fs.promises;


//assert_group(sequence, () => {


let dir = new URL();

const package_dir = URL.resolveRelative("../", dir);


const dirs = await fsp.readdir(package_dir + "", {
    withFileTypes: true
});


const packages = {}, package_arr = [];

for (const { name } of dirs) {
    const dir = URL.resolveRelative("./" + name, package_dir) + "";
    const data = await getPackageJsonObject(dir + "/");
    packages[name] = {
        name: name,
        path: dir + "/package.json",
        version: data.package.version,
        package: data.package
    };

    package_arr.push(packages[name]);
}
const regex = (/\@candle(lib|fw)\/(?<n>\w+)/);

for (const package_name in packages) {
    const pkg = packages[package_name].package;
    // Update version for all CandleLibrary dependencies
    if (pkg.dependencies) {

        for (const name in pkg.dependencies) {
            const matches = name.match(regex);
            if (matches) {
                const dep_name = matches.groups.n;

                if (packages[dep_name]) {

                    const dep_version = packages[dep_name].version;

                    pkg.dependencies[name] = dep_version;
                }
            }
        }
    }
}

for (const p of package_arr) {
    const package = p.package;
    const path = p.path;
    await fsp.writeFile(path, JSON.stringify(package, null, 4), { encoding: "utf8" });
}

  //  assert(i, packages === "");
//});