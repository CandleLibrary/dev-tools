#! /usr/bin/node

import { getPackageJsonObject } from "@candlelib/paraffin";

const print = console.log;

const { package: pkg } = await getPackageJsonObject();
const dependencies = Object.getOwnPropertyNames(pkg["devDependencies"]).map(r => r.replace("@candlelib/", ""));

print(dependencies.join(" "));

export { dependencies as dependency_names };