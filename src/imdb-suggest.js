ObjC.import("Foundation");
ObjC.import("stdlib");

const ICON = "icon.png";

/**
 * Lee archivo de texto si existe
 * @param {string} filepath - Ruta del archivo
 * @param {Object} fileManager - NSFileManager instance
 * @returns {string|null} Contenido del archivo o null
 */
function readTextFile(filepath, fileManager) {
	if (!fileManager.fileExistsAtPath(filepath)) return null;

	const data = $.NSData.dataWithContentsOfFile(filepath);
	if (!data) return null;

	return $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding)
		.js;
}

/**
 * Escribe archivo de texto
 * @param {string} filepath - Ruta del archivo
 * @param {string} content - Contenido a escribir
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
 * Convierte sugerencias de IMDb en items de Alfred
 * @param {Object[]} suggestions - Array de sugerencias de IMDb
 * @param {string} cacheDir - Directorio de cache para imágenes
 * @param {Object} fileManager - NSFileManager instance
 * @returns {Object[]} Array de items de Alfred
 */
function makeItems(suggestions, cacheDir, fileManager) {
	const imagesDir = cacheDir + "/images";

	// Crear directorio de imágenes una sola vez
	fileManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(
		$(imagesDir),
		true,
		$(),
		$()
	);

	return suggestions.map((sugg) => {
		const title = sugg.l;
		const subtitle = sugg.s || "";

		// Manejar icono con caché de imágenes
		let icon = ICON;
		if (sugg.i && sugg.i.imageUrl) {
			try {
				const imageUrl = sugg.i.imageUrl.replace("_V1_", "_V1_UY100");
				const filename = imageUrl.split("/").pop().split("?")[0];
				const filepath = imagesDir + "/" + filename;

				// Si la imagen ya existe, usarla
				if (fileManager.fileExistsAtPath(filepath)) {
					icon = filepath;
				} else {
					// Intentar descargar solo si no existe
					const imgURL = $.NSURL.URLWithString(imageUrl);
					const imgData = $.NSData.dataWithContentsOfURL(imgURL);
					if (imgData && imgData.length > 0) {
						imgData.writeToFileAtomically(filepath, true);
						icon = filepath;
					}
					// Si falla, usa icono por defecto (ya asignado)
				}
			} catch (e) {
				// Silenciosamente usar icono por defecto si hay error
			}
		}

		return {
			uid: sugg.id,
			title: title,
			subtitle: subtitle,
			arg: sugg.id,
			icon: { path: icon },
			mods: {
				cmd: {
					arg: sugg.id,
					subtitle: `⌘ Copy IMDb ID: ${sugg.id}`,
				},
			},
			valid: true,
		};
	});
}

/**
 * Obtiene sugerencias de IMDb desde la API
 * @param {string} query - Búsqueda
 * @returns {Object[]} Array de sugerencias
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
 * Limpia imágenes antiguas manteniendo solo las N más recientes
 * @param {string} cacheDir - Directorio de caché
 * @param {Object} fileManager - NSFileManager instance
 * @param {number} maxFiles - Número máximo de archivos a mantener
 */
function cleanupImageCache(cacheDir, fileManager, maxFiles = 300) {
	try {
		const imagesDir = cacheDir + "/images";

		// Verificar que el directorio existe
		if (!fileManager.fileExistsAtPath(imagesDir)) return;

		const files = fileManager.contentsOfDirectoryAtPathError(
			$(imagesDir),
			$()
		);
		if (!files || files.count === 0) return;

		const imageFiles = [];
		for (let i = 0; i < files.count; i++) {
			const filename = ObjC.unwrap(files.objectAtIndex(i));
			// Filtrar archivos de imagen
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

		// Solo limpiar si excedemos el límite
		if (imageFiles.length <= maxFiles) return;

		// Ordenar por fecha de modificación (más recientes primero)
		imageFiles.sort((a, b) => b.modTime - a.modTime);

		// Eliminar archivos antiguos
		for (let i = maxFiles; i < imageFiles.length; i++) {
			fileManager.removeItemAtPathError($(imageFiles[i].path), $());
		}
	} catch (e) {
		// Ignorar errores de limpieza para no interrumpir el workflow
	}
}

/**
 * Punto de entrada principal
 * @param {string[]} argv - Argumentos (query)
 * @returns {string} JSON para Alfred Script Filter
 */
function run(argv) {
	const query = argv[0]?.trim() || "";

	if (!query) {
		return JSON.stringify({ items: [] });
	}

	if (query.length < 3) {
		return JSON.stringify({
			items: [
				{
					title: "Keep typing...",
					subtitle: `Type at least 3 characters to search IMDb`,
					icon: { path: ICON },
					valid: false,
				},
			],
		});
	}

	const env = $.NSProcessInfo.processInfo.environment;
	const workflowCache = ObjC.unwrap(
		env.objectForKey("alfred_workflow_cache")
	);
	const cacheDir = workflowCache || "/tmp/alfred-imdb-cache";
	const fileManager = $.NSFileManager.defaultManager;

	// Crear directorio de caché
	fileManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(
		$(cacheDir),
		true,
		$(),
		$()
	);

	const cacheFile = `${cacheDir}/cache.json`;

	// Leer caché existente
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
	const cacheExpiry = 300; // 5 minutos

	// Verificar si tenemos datos válidos en caché
	if (
		cache[queryKey] &&
		cache[queryKey].timestamp &&
		currentTime - cache[queryKey].timestamp < cacheExpiry
	) {
		return JSON.stringify(cache[queryKey].data);
	}

	// Debouncing: no hacer requests muy frecuentes
	const lastQueryTime = cache._lastRequestTime || 0;
	const timeSinceLastRequest = currentTime - lastQueryTime;

	if (timeSinceLastRequest < 1) {
		// Mostrar últimos resultados solo si son de la misma query
		if (cache._lastResults && cache._lastQuery === queryKey) {
			return JSON.stringify(cache._lastResults);
		}
		// Si es una query diferente, mostrar mensaje de carga
		return JSON.stringify({
			items: [
				{
					title: "Searching IMDb...",
					subtitle: "Results loading",
					icon: { path: ICON },
					valid: false,
				},
			],
		});
	}

	// Limpiar caché de imágenes ocasionalmente (5% de probabilidad)
	if (Math.random() < 0.05) {
		cleanupImageCache(cacheDir, fileManager, 300);
	}

	// Obtener datos frescos
	try {
		const suggestions = fetchSuggestions(query);

		let resultData;
		if (!suggestions || suggestions.length === 0) {
			resultData = {
				items: [
					{
						title: "No results found",
						subtitle: `No IMDb results for "${query}"`,
						icon: { path: ICON },
						valid: false,
					},
				],
			};
		} else {
			resultData = {
				items: makeItems(suggestions, cacheDir, fileManager),
			};
		}

		// Actualizar caché con timestamp actual
		cache[queryKey] = {
			data: resultData,
			timestamp: currentTime,
		};

		// Guardar últimos resultados, query y tiempo de request
		cache._lastResults = resultData;
		cache._lastQuery = queryKey;
		cache._lastRequestTime = currentTime;

		// Limpiar entradas antiguas del caché (mantener últimas 20 búsquedas)
		const entries = Object.entries(cache).filter(
			([key]) => !key.startsWith("_")
		);
		if (entries.length > 20) {
			entries.sort(
				(a, b) => (b[1].timestamp || 0) - (a[1].timestamp || 0)
			);
			const newCache = Object.fromEntries(entries.slice(0, 20));
			// Preservar variables internas
			newCache._lastRequestTime = cache._lastRequestTime;
			newCache._lastResults = cache._lastResults;
			newCache._lastQuery = cache._lastQuery;
			cache = newCache;
		}

		// Guardar caché actualizado
		writeTextFile(cacheFile, JSON.stringify(cache));

		return JSON.stringify(resultData);
	} catch (error) {
		return JSON.stringify({
			items: [
				{
					title: "Error",
					subtitle: error.message || String(error),
					icon: { path: ICON },
					valid: false,
				},
			],
		});
	}
}
