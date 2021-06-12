#! /usr/bin/bash

##############################################################
#
# Get absolute paths to workspace folders

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
WK_DIR="$SCRIPT_DIR/../../."
JS_SCRIPTS_DIR="$WK_DIR/source/js"
WORKSPACE_DIR=$1

##############################################################
#
# Prompt for the the location of the project directory
echo "Pleaes specify a location for the project workspace"
read WORKSPACE_DIR

LOCAL_ROOT_PACKAGE_REPO="$WORKSPACE_DIR/node_modules"

##############################################################
#
# Create the project directory and record
# its location.

echo "Creating $WORKSPACE_DIR"
mkdir -p $WORKSPACE_DIR 

echo "WORKSPACE_DIR=$WORKSPACE_DIR" > "$WK_DIR/CANDLE_ENV"


##############################################################
#
# Verify Node.JS is installed
node_version=$(node --version)

if [[ $? -ne 0 ]]; 
then 

echo "
Unable to continue, Node.js runtime not found. 
Please install a recent version of NodeJS (>=14.0.0)
and rerun this script:

yarn install 
"
exit -1

else

echo "Using Node.js $node_version"

fi

##############################################################
#
# Retrieve a list of CandleLib packages and prepare them for
# repo cloning

repo_name_list=$( "$JS_SCRIPTS_DIR/get_package_names_for_sh.js" )
repo_root=$( "$JS_SCRIPTS_DIR/get_repository_project_root_for_sh.js" )
repo_package_location=$LOCAL_ROOT_PACKAGE_REPO/@candlelib/

for repo_name in $repo_name_list; do

    repo_url=ssh://git@$repo_root/$repo_name.git
    repo_directory=$WORKSPACE_DIR/$repo_name

    echo "\nCloning $repo_name"

    git clone $repo_url $repo_directory

    echo "Checking out dev branch"

    cd $repo_directory

    git checkout dev

    echo "Installing Package"

    echo "Removing default node_modules@candlelib folder"

done

for repo_name in $repo_name_list; do
    
    repo_directory=$WORKSPACE_DIR/$repo_name

    mkdir -p $repo_package_location

    echo "Creating link $repo_name"

    ln -sf $repo_directory $repo_package_location    

done






