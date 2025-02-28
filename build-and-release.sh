#!/bin/zsh
# BUILD AND RELEASE
#───────────────────────────────────────────────────────────────────────────────

# goto git root
cd "$(git rev-parse --show-toplevel)" || return 1

# Prompt for next version number
currentVersion=$(plutil -extract version xml1 -o - info.plist | sed -n 's/.*<string>\(.*\)<\/string>.*/\1/p')
echo "current version: $currentVersion"
echo -n "   next version: "
read -r nextVersion
echo "────────────────────────"

# update version number in *repo* info.plist
plutil -replace version -string "$nextVersion" info.plist

# INFO specific to my setup: update version number in *local* info.plist 
localInfoPlist="$DOTFILE_FOLDER/Alfred.alfredpreferences/workflows/$(basename "$PWD")/info.plist"
if [[ -f "$localInfoPlist" ]]; then
	plutil -replace version -string "$nextVersion" "$localInfoPlist"
fi

#───────────────────────────────────────────────────────────────────────────────

# git operations
git add -A
git commit -m "release: $nextVersion"
git pull
git push

# trigger the release action via github action
git tag "$nextVersion" 
git push origin --tags
