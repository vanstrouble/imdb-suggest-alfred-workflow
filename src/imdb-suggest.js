ObjC.import('Foundation');
ObjC.import('stdlib');

const ICON = 'icon.png';

/**
 * Genera un hash simple para usar como identificador de estado
 * @param {string} str - String a hashear
 * @returns {string} Hash simple
 */
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString();
}

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

    return $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding).js;
}

/**
 * Escribe archivo de texto
 * @param {string} filepath - Ruta del archivo
 * @param {string} content - Contenido a escribir
 */
function writeTextFile(filepath, content) {
    const nsString = $.NSString.stringWithString(content);
    nsString.writeToFileAtomicallyEncodingError(filepath, true, $.NSUTF8StringEncoding, $());
}

/**
 * Muestra resultados del caché y termina
 * @param {string} cacheFile - Archivo de caché
 * @param {Object} fileManager - NSFileManager instance
 */
function showCachedData(cacheFile, fileManager) {
    const cachedData = readTextFile(cacheFile, fileManager);
    if (cachedData) {
        return cachedData;
    }

    // Si el caché falló, mostrar mensaje de error
    return JSON.stringify({
        items: [{
            title: 'Unable to Load Results',
            subtitle: 'Cache error, try again',
            icon: { path: ICON },
            valid: false
        }]
    });
}

/**
 * Convierte sugerencias de IMDb en items de Alfred
 * @param {Object[]} suggestions - Array de sugerencias de IMDb
 * @param {string} cacheDir - Directorio de cache para imágenes
 * @param {Object} fileManager - NSFileManager instance
 * @returns {Object[]} Array de items de Alfred
 */
function makeItems(suggestions, cacheDir, fileManager) {
    return suggestions.map((sugg) => {
        const title = sugg.l;
        const subtitle = sugg.s || '';

        // Manejar icono (caché solo para imágenes que es lo que tarda)
        let icon = ICON;
        if (sugg.i && sugg.i.imageUrl) {
            const imageUrl = sugg.i.imageUrl.replace('_V1_', '_V1_UY100');
            const filename = imageUrl.split('/').pop().split('?')[0];
            const imagesDir = cacheDir + '/images';
            const filepath = imagesDir + '/' + filename;

            // Crear directorio de imágenes si no existe
            fileManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError($(imagesDir), true, $(), $());

            // Usar imagen cacheada si existe
            if (fileManager.fileExistsAtPath(filepath)) {
                icon = filepath;
            } else {
                // Descargar imagen en background
                const imgURL = $.NSURL.URLWithString(imageUrl);
                const imgData = $.NSData.dataWithContentsOfURL(imgURL);
                if (imgData) {
                    imgData.writeToFileAtomically(filepath, true);
                    icon = filepath;
                }
            }
        }

        // Objeto simplificado - solo pasar el código IMDb
        return {
            uid: sugg.id,
            title: title,
            subtitle: subtitle,
            arg: sugg.id,
            icon: { path: icon },
            mods: {
                cmd: {
                    arg: sugg.id,
                    subtitle: `Copy IMDb ID: ${sugg.id}`
                }
            },
            valid: true
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
        const url = `https://v2.sg.media-imdb.com/suggestion/${query[0]}/${encodeURIComponent(query)}.json`;
        const nsURL = $.NSURL.URLWithString(url);
        const data = $.NSData.dataWithContentsOfURL(nsURL);

        if (!data) {
            return [];
        }

        const jsonString = $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding).js;
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
        const imagesDir = cacheDir + '/images';
        const files = fileManager.contentsOfDirectoryAtPathError($(imagesDir), $());
        if (!files) return;

        // Filtrar solo archivos de imagen (jpg, png, etc.)
        const imageFiles = [];
        for (let i = 0; i < files.count; i++) {
            const filename = ObjC.unwrap(files.objectAtIndex(i));
            if (filename.match(/\.(jpg|jpeg|png|gif)$/i)) {
                const filepath = `${imagesDir}/${filename}`;
                const attrs = fileManager.attributesOfItemAtPathError($(filepath), $());
                if (attrs) {
                    const modDate = ObjC.unwrap(attrs.objectForKey('NSFileModificationDate'));
                    imageFiles.push({
                        path: filepath,
                        modTime: modDate.timeIntervalSince1970
                    });
                }
            }
        }

        if (imageFiles.length <= maxFiles) return;

        // Ordenar por fecha (más recientes primero) y eliminar antiguos
        imageFiles.sort((a, b) => b.modTime - a.modTime);
        for (let i = maxFiles; i < imageFiles.length; i++) {
            fileManager.removeItemAtPathError($(imageFiles[i].path), $());
        }
    } catch (e) {
        // Ignorar errores de limpieza
    }
}

/**
 * Punto de entrada principal
 * @param {string[]} argv - Argumentos (query)
 * @returns {string} JSON para Alfred Script Filter
 */
function run(argv) {
    const query = argv[0]?.trim() || '';

    if (!query) {
        return JSON.stringify({ items: [] });
    }

    // Implementar debouncing simple
    if (query.length < 3) {
        return JSON.stringify({
            items: [{
                title: 'Keep typing...',
                subtitle: `Type at least 3 characters to search IMDb`,
                icon: { path: ICON },
                valid: false
            }]
        });
    }

    // Configurar archivos de caché y estado
    const env = $.NSProcessInfo.processInfo.environment;
    const workflowCache = ObjC.unwrap(env.objectForKey('alfred_workflow_cache'));
    const cacheDir = workflowCache || '/tmp/alfred-imdb-cache';
    const fileManager = $.NSFileManager.defaultManager;
    fileManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError($(cacheDir), true, $(), $());

    // Archivos únicos de caché y estado
    const cacheFile = `${cacheDir}/cache.json`;
    const stateFile = `${cacheDir}/state.txt`;

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

    // Generar clave para esta query
    const queryKey = query.toLowerCase();
    const currentTime = Math.floor(Date.now() / 1000);
    const cacheExpiry = 300; // 5 minutos

    // Verificar si tenemos datos válidos en caché
    if (cache[queryKey] &&
        cache[queryKey].timestamp &&
        (currentTime - cache[queryKey].timestamp) < cacheExpiry) {
        return JSON.stringify(cache[queryKey].data);
    }

    // Debouncing adicional: no hacer requests muy frecuentes
    const lastQueryTime = cache._lastRequestTime || 0;
    const timeSinceLastRequest = currentTime - lastQueryTime;

    if (timeSinceLastRequest < 2) { // Mínimo 2 segundos entre requests diferentes
        return JSON.stringify({
            items: [{
                title: 'Searching...',
                subtitle: `Please wait a moment before searching again`,
                icon: { path: ICON },
                valid: false
            }]
        });
    }

    // Actualizar timestamp del último request
    cache._lastRequestTime = currentTime;

    // Limpiar caché de imágenes ocasionalmente (solo 10% de las veces)
    if (Math.random() < 0.1) {
        cleanupImageCache(cacheDir, fileManager, 300);
    }

    // Obtener datos frescos
    try {
        const suggestions = fetchSuggestions(query);

        let resultData;
        if (!suggestions || suggestions.length === 0) {
            resultData = {
                items: [{
                    title: 'No results found',
                    subtitle: `No IMDb results for "${query}"`,
                    icon: { path: ICON },
                    valid: false
                }]
            };
        } else {
            resultData = {
                items: makeItems(suggestions, cacheDir, fileManager)
            };
        }

        // Actualizar caché con nueva data
        cache[queryKey] = {
            data: resultData,
            timestamp: currentTime
        };

        // Limpiar entradas antiguas del caché (mantener solo las últimas 20 búsquedas)
        const entries = Object.entries(cache);
        if (entries.length > 20) {
            entries.sort((a, b) => (b[1].timestamp || 0) - (a[1].timestamp || 0));
            cache = Object.fromEntries(entries.slice(0, 20));
        }

        // Guardar caché actualizado
        writeTextFile(cacheFile, JSON.stringify(cache));
        writeTextFile(stateFile, currentTime.toString());

        return JSON.stringify(resultData);
    } catch (error) {
        const errorData = {
            items: [{
                title: 'Error',
                subtitle: error.message || String(error),
                icon: { path: ICON },
                valid: false
            }]
        };

        return JSON.stringify(errorData);
    }
}
