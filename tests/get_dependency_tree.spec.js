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

console.log(dirs);

const packages = {}, package_arr = [];

const regex = (/\@candle(lib|fw)\/(?<n>\w+)/);

for (const { name } of dirs.filter(d => d.isDirectory())) {
    const dir = URL.resolveRelative("./" + name, package_dir) + "";
    const data = await getPackageJsonObject(dir + "/");
    const matches = data?.package?.name?.match(regex);

    if (matches) {

        const package_name = matches.groups.n;
        packages[package_name] = {
            name: name,
            path: dir + "/package.json",
            version: data.package.version,
            package: data.package
        };

        package_arr.push(packages[package_name]);
    }
}


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
    if (pkg.devDependencies) {
        for (const name in pkg.devDependencies) {
            const matches = name.match(regex);
            if (matches) {
                const dep_name = matches.groups.n;

                if (packages[dep_name]) {

                    const dep_version = packages[dep_name].version;

                    pkg.devDependencies[name] = dep_version;
                }
            }
        }
    }
}

for (const p of package_arr) {
    const pkg = p.package;
    const path = p.path;

    await fsp.writeFile(path, JSON.stringify(pkg, null, 4), { encoding: "utf8" });
}

  //  assert(i, packages === "");
//});