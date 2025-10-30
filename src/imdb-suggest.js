ObjC.import('Foundation');
ObjC.import('stdlib');

const ICON = '66323B0D-F24D-4F0C-BCB2-42D2BFA92C0F.png';

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
            const filepath = cacheDir + '/' + filename;

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

        // Construir URL
        let subpath = sugg.id;
        const prefix = subpath.substring(0, 2);

        if (prefix === 'tt') {
            subpath = `/title/${subpath}`;
        } else if (prefix === 'nm') {
            subpath = `/name/${subpath}`;
        }

        const arg = `https://www.imdb.com${subpath}`;

        return {
            uid: sugg.id,
            title: title,
            subtitle: subtitle,
            arg: arg,
            icon: { path: icon },
            autocomplete: title,
            text: {
                copy: title,
                largetype: title
            },
            quicklookurl: arg,
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
 * Punto de entrada principal
 * @param {string[]} argv - Argumentos (query)
 * @returns {string} JSON para Alfred Script Filter
 */
function run(argv) {
    const query = argv[0]?.trim() || '';

    if (!query) {
        return JSON.stringify({ items: [] });
    }

    // Configurar directorio de cache solo para imágenes
    const env = $.NSProcessInfo.processInfo.environment;
    const workflowCache = ObjC.unwrap(env.objectForKey('alfred_workflow_cache'));
    const cacheDir = workflowCache ? workflowCache + '/imdb' : '/tmp/alfred-imdb-cache';
    const fileManager = $.NSFileManager.defaultManager;
    fileManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError($(cacheDir), true, $(), $());

    // Siempre hacer fetch fresco de sugerencias
    try {
        const suggestions = fetchSuggestions(query);

        if (!suggestions || suggestions.length === 0) {
            return JSON.stringify({
                items: [{
                    title: 'No results found',
                    subtitle: `No IMDb results for "${query}"`,
                    icon: { path: ICON },
                    valid: false
                }]
            });
        }

        return JSON.stringify({
            items: makeItems(suggestions, cacheDir, fileManager)
        });
    } catch (error) {
        return JSON.stringify({
            items: [{
                title: 'Error',
                subtitle: error.message || String(error),
                icon: { path: ICON },
                valid: false
            }]
        });
    }
}
