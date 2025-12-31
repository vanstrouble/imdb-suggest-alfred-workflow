ObjC.import("Foundation");
ObjC.import("stdlib");

const ICON = "icon.png";
const SHOW_POSTER = (() => {
	const env = $.NSProcessInfo.processInfo.environment;
	const showPoster = ObjC.unwrap(env.objectForKey("show_poster"));
	return showPoster === "1" || showPoster === "true";
})();

/**
 * Reads text file if exists
 * @param {string} filepath - File path
 * @param {Object} fileManager - NSFileManager instance
 * @returns {string|null} File content or null
 */
function readTextFile(filepath, fileManager) {
	if (!fileManager.fileExistsAtPath(filepath)) return null;

	const data = $.NSData.dataWithContentsOfFile(filepath);
	if (!data) return null;

	return $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding)
		.js;
}

/**
 * Writes text file
 * @param {string} filepath - File path
 * @param {string} content - Content to write
 */
function writeTextFile(filepath, content) {
	const nsString = $.NSString.stringWithString(content);
	nsString.writeToFileAtomicallyEncodingError(
		filepath,
		true,
		$.NSUTF8StringEncoding,
		$()
	);
}

/**
 * Creates a simple Alfred item (for errors, messages, etc)
 * @param {string} title - Item title
 * @param {string} subtitle - Item subtitle
 * @param {boolean} valid - Whether item is actionable
 * @returns {Object} Alfred item
 */
function createSimpleItem(title, subtitle, valid = false) {
	return {
		title: title,
		subtitle: subtitle,
		icon: { path: ICON },
		valid: valid,
	};
}

/**
 * Creates result data with optional Alfred cache
 * @param {Object[]} items - Array of Alfred items
 * @param {boolean} useAlfredCache - Whether to add Alfred cache directive
 * @returns {Object} Result data object
 */
function createResultData(items, useAlfredCache = false) {
	const result = { items: items };
	if (useAlfredCache) {
		result.cache = { seconds: 30, loosereload: true };
	}
	return result;
}

/**
 * Converts IMDb suggestions to Alfred items
 * @param {Object[]} suggestions - IMDb suggestions array
 * @param {string} cacheDir - Cache directory for images
 * @param {Object} fileManager - NSFileManager instance
 * @returns {Object[]} Alfred items array
 */
function makeItems(suggestions, cacheDir, fileManager) {
	return suggestions.map((sugg) => {
		let icon = ICON;
		// Only download and use posters if SHOW_POSTER is enabled
		if (SHOW_POSTER && sugg.i && sugg.i.imageUrl) {
			const imagesDir = cacheDir + "/images";
			fileManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(
				$(imagesDir),
				true,
				$(),
				$()
			);
			try {
				const imageUrl = sugg.i.imageUrl.replace("_V1_", "_V1_UY100");
				const filename = imageUrl.split("/").pop().split("?")[0];
				const filepath = imagesDir + "/" + filename;

				if (fileManager.fileExistsAtPath(filepath)) {
					icon = filepath;
				} else {
					const imgURL = $.NSURL.URLWithString(imageUrl);
					const imgData = $.NSData.dataWithContentsOfURL(imgURL);
					if (imgData && imgData.length > 0) {
						imgData.writeToFileAtomically(filepath, true);
						icon = filepath;
					}
				}
			} catch (e) {
				// Use default icon on error
			}
		}

		return {
			uid: sugg.id,
			title: sugg.l,
			subtitle: sugg.s || "",
			arg: sugg.id,
			icon: { path: icon },
			mods: {
				cmd: {
					arg: sugg.id,
					subtitle: `⌘ Copy IMDb ID: ${sugg.id}`,
				},
			},
			quicklookurl: `https://www.imdb.com/title/${sugg.id}/`,
			valid: true,
		};
	});
}

/**
 * Fetches suggestions and returns Alfred items
 * @param {string} query - Search query
 * @param {string} cacheDir - Cache directory
 * @param {Object} fileManager - NSFileManager instance
 * @returns {Object[]} Alfred items array
 */
function fetchAndMakeItems(query, cacheDir, fileManager) {
	const suggestions = fetchSuggestions(query);
	return !suggestions || suggestions.length === 0
		? [
				createSimpleItem(
					"No results found",
					`No IMDb results for "${query}"`
				),
		  ]
		: makeItems(suggestions, cacheDir, fileManager);
}

/**
 * Fetches suggestions from IMDb API
 * @param {string} query - Search query
 * @returns {Object[]} Suggestions array
 */
function fetchSuggestions(query) {
	try {
		const url = `https://v2.sg.media-imdb.com/suggestion/${
			query[0]
		}/${encodeURIComponent(query)}.json`;
		const nsURL = $.NSURL.URLWithString(url);
		const data = $.NSData.dataWithContentsOfURL(nsURL);

		if (!data) {
			return [];
		}

		const jsonString = $.NSString.alloc.initWithDataEncoding(
			data,
			$.NSUTF8StringEncoding
		).js;
		const json = JSON.parse(jsonString);

		return json.d || [];
	} catch (e) {
		return [];
	}
}

/**
 * Cleans old images keeping only N most recent
 * @param {string} cacheDir - Cache directory
 * @param {Object} fileManager - NSFileManager instance
 * @param {number} maxFiles - Maximum files to keep
 */
function cleanupImageCache(cacheDir, fileManager, maxFiles = 300) {
	try {
		const imagesDir = cacheDir + "/images";

		if (!fileManager.fileExistsAtPath(imagesDir)) return;

		const files = fileManager.contentsOfDirectoryAtPathError(
			$(imagesDir),
			$()
		);
		if (!files || files.count === 0) return;

		const imageFiles = [];
		for (let i = 0; i < files.count; i++) {
			const filename = ObjC.unwrap(files.objectAtIndex(i));
			if (filename.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
				const filepath = `${imagesDir}/${filename}`;
				const attrs = fileManager.attributesOfItemAtPathError(
					$(filepath),
					$()
				);
				if (attrs) {
					const modDate = ObjC.unwrap(
						attrs.objectForKey("NSFileModificationDate")
					);
					imageFiles.push({
						path: filepath,
						modTime: modDate.timeIntervalSince1970,
					});
				}
			}
		}

		if (imageFiles.length <= maxFiles) return;

		imageFiles.sort((a, b) => b.modTime - a.modTime);

		for (let i = maxFiles; i < imageFiles.length; i++) {
			fileManager.removeItemAtPathError($(imageFiles[i].path), $());
		}
	} catch (e) {
		// Ignore cleanup errors
	}
}

/**
 * Main entry point
 * @param {string[]} argv - Arguments (query)
 * @returns {string} JSON for Alfred Script Filter
 */
function run(argv) {
	const query = argv[0]?.trim() || "";

	if (!query) {
		return JSON.stringify(createResultData([]));
	}

	if (query.length < 3) {
		return JSON.stringify(
			createResultData([
				createSimpleItem(
					"Keep typing...",
					`Type at least 3 characters to search IMDb`
				),
			])
		);
	}

	const env = $.NSProcessInfo.processInfo.environment;
	const workflowCache = ObjC.unwrap(
		env.objectForKey("alfred_workflow_cache")
	);
	const cacheDir = workflowCache || "/tmp/alfred-imdb-cache";
	const fileManager = $.NSFileManager.defaultManager;

	fileManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(
		$(cacheDir),
		true,
		$(),
		$()
	);

	const cacheFile = `${cacheDir}/cache.json`;

	// Cleanup image cache occasionally (5% probability)
	if (Math.random() < 0.05) {
		cleanupImageCache(cacheDir, fileManager, 300);
	}

	// When SHOW_POSTER is disabled, skip file cache and let Alfred handle caching
	if (!SHOW_POSTER) {
		try {
			return JSON.stringify(
				createResultData(
					fetchAndMakeItems(query, cacheDir, fileManager),
					true
				)
			);
		} catch (error) {
			return JSON.stringify(
				createResultData(
					[createSimpleItem("Error", error.message || String(error))],
					true
				)
			);
		}
	}

	// SHOW_POSTER enabled: use file cache
	let cache = {};
	const cacheData = readTextFile(cacheFile, fileManager);
	if (cacheData) {
		try {
			cache = JSON.parse(cacheData);
		} catch (e) {
			cache = {};
		}
	}

	const queryKey = query.toLowerCase();
	const currentTime = Math.floor(Date.now() / 1000);
	const cacheExpiry = 300; // 5 minutes

	// Return cached data if valid
	if (
		cache[queryKey] &&
		cache[queryKey].timestamp &&
		currentTime - cache[queryKey].timestamp < cacheExpiry
	) {
		const suggestions = cache[queryKey].suggestions;
		const items = suggestions?.length
			? makeItems(suggestions, cacheDir, fileManager)
			: cache[queryKey].data.items;
		return JSON.stringify(createResultData(items));
	}

	// Debouncing: avoid too frequent requests
	const lastQueryTime = cache._lastRequestTime || 0;
	const timeSinceLastRequest = currentTime - lastQueryTime;

	if (timeSinceLastRequest < 1) {
		// Show last results only if same query
		if (cache._lastResults && cache._lastQuery === queryKey) {
			return JSON.stringify(cache._lastResults);
		}
		// Show loading message for different query
		return JSON.stringify(
			createResultData([
				createSimpleItem("Searching IMDb...", "Results loading"),
			])
		);
	}

	// Fetch fresh data
	try {
		const suggestions = fetchSuggestions(query);
		const items = fetchAndMakeItems(query, cacheDir, fileManager);
		const resultData = createResultData(items);

		// Update cache - store raw suggestions for dynamic processing
		cache[queryKey] = {
			suggestions: suggestions,
			data: resultData,
			timestamp: currentTime,
		};

		// Save last results, query and request time
		cache._lastResults = resultData;
		cache._lastQuery = queryKey;
		cache._lastRequestTime = currentTime;

		// Clean old cache entries (keep last 20 searches)
		const entries = Object.entries(cache).filter(
			([key]) => !key.startsWith("_")
		);
		if (entries.length > 20) {
			entries.sort(
				(a, b) => (b[1].timestamp || 0) - (a[1].timestamp || 0)
			);
			const newCache = Object.fromEntries(entries.slice(0, 20));
			// Preserve internal variables
			newCache._lastRequestTime = cache._lastRequestTime;
			newCache._lastResults = cache._lastResults;
			newCache._lastQuery = cache._lastQuery;
			cache = newCache;
		}

		writeTextFile(cacheFile, JSON.stringify(cache));

		return JSON.stringify(resultData);
	} catch (error) {
		return JSON.stringify(
			createResultData([
				createSimpleItem("Error", error.message || String(error)),
			])
		);
	}
}
