import { Mod } from "./types";
import * as utilities from "./utilities";

// read args (format: `nodeExecutable scriptPath jsonFilePath+`)
const jsonFilePaths = process.argv.splice(2);

// load data
let mods: Mod[] = [];
for (const jsonFilePath of jsonFilePaths) {
	try {
		// read file
		const data = utilities.loadJSONFile<{ mods: Mod[], brokenContentPacks: Mod[] }>(jsonFilePath);

		// validate file has exactly one mod list
		if (!data.mods && !data.brokenContentPacks)
			throw new Error("Each file must specify `mods` or `brokenContentPacks`.");
		if (data.mods && data.brokenContentPacks)
			throw new Error("Each file must specify either `mods` or `brokenContentPacks`, but not both at once.");

		// extract mods
		const modsInFile = data.mods ?? data.brokenContentPacks;
		for (const mod of modsInFile)
			mod.jsonFilePath = jsonFilePath;

		mods.push(...modsInFile);
	}
	catch (error) {
		console.error(`❌ Error loading data file: ${(error as Error)?.message ?? error}`);
		process.exit(1);
	}
}

// normalize data
for(const mod of mods) {
	mod.mainName = mod.name.split(",")[0].trim();
	mod.status = utilities.getModStatus(mod);
}
const modsByName = utilities.buildModLookupByName(mods);

// detect mod issues
let hasErrors = false;
const modsById: Record<string, Mod> = {};
for (const mod of mods) {
	// ensure ID is unique
	if (mod.id && mod.id !== "none") {
		for (let id of mod.id.split(',')) {
			id = id.trim();
			if (modsById[id])
				hasErrors = utilities.logModError(mod, `has ID '${id}', which is also assigned to mod '${modsById[id].mainName}'.`);
			else
				modsById[id] = mod;
		}
	}

	// check mod links in summary
	for (const link of utilities.extractLocalModLinksFromMarkdown(mod.summary))	{
		// invalid format
		if (link.url != "#") {
			hasErrors = utilities.logModError(mod, `has a link with custom anchor URL '${link.url}'. To link to another mod on the list, set the link text to the exact mod name and the URL to '#'.`);
			continue;
		}

		// target not found
		const targets = modsByName[link.modName.toLowerCase()];
		if (!targets) {
			hasErrors = utilities.logModError(mod, `has a summary link to mod '${link.modName}', which wasn't found.`);
			continue;
		}

		// target not compatible (so shouldn't be listed as a workaround)
		const statuses = new Set(targets.map(target => target.status));
		if (!statuses.has("ok") && !statuses.has("optional") && !statuses.has("unofficial")) {
			let message = `❌ Mod '${mod.mainName}' has a summary link to mod '${link.modName}', which has status '${[... statuses].join("', '")}'.`;
			if (statuses.has("workaround"))
				message += " It should link directly to the working mod instead.";
			hasErrors = utilities.logModError(mod, message);
			continue;
		}
	}

	// check unofficial URL format
	if (mod.unofficialUpdate?.url) {
		// parse URL
		let url: URL;
		try {
			url = new URL(mod.unofficialUpdate.url);
		}
		catch {
			hasErrors = utilities.logModError(mod, `has unofficial update URL '${mod.unofficialUpdate.url}', which isn't a valid URL.`);
			continue;
		}

		// make sure it's a permalink
		if (url.hostname === "forums.stardewvalley.net" && !url.pathname.includes("/post-")) {
			if (url.pathname.startsWith("/threads/") && url.hash.startsWith("#post-")) {
				const threadKey = url.pathname.split('/')[2];
				hasErrors = utilities.logModError(mod, `has unofficial update URL '${mod.unofficialUpdate.url}', which isn't a permalink. Expected format: https://${url.hostname}/threads/${threadKey}/${url.hash.substring(1)}`);
			}
			else
				hasErrors = utilities.logModError(mod, `has unofficial update URL '${mod.unofficialUpdate.url}', which doesn't seem to be a permalink (ending with /post-XXX).`);
			continue;
		}

		// make sure it's HTTPS
		if (url.protocol !== "https:") {
			hasErrors = utilities.logModError(mod, `has unofficial update URL '${mod.unofficialUpdate.url}', which isn't an HTTPS link.`);
			continue;
		}
	}

	// check 'retest when compatible' field
	if (mod.retestWhenCompatible) {
		if (mod.status === "ok" || mod.status === "optional")
			hasErrors = utilities.logModError(mod, "is marked compatible, but still has the 'retestWhenCompatible' field set.");
		else {
			for (const otherName of mod.retestWhenCompatible) {
				// target not found
				const targets = modsByName[otherName.toLowerCase()];
				if (!targets) {
					hasErrors = utilities.logModError(mod, `should be retested when '${otherName}' is updated (per its retestWhenCompatible field), but no such mod was found.`);
					continue;
				}

				// target already compatible
				const statuses = new Set(targets.map(target => target.status));
				if (statuses.has("ok") || statuses.has("optional") || statuses.has("unofficial")) {
					hasErrors = utilities.logModError(mod, `should be retested when '${otherName}' is updated (per its retestWhenCompatible field), but that mod is already compatible.`);
					continue;
				}
			}
		}
	}
}

if (hasErrors)
	process.exit(1);

console.log("✅ No mod data issues detected.");
