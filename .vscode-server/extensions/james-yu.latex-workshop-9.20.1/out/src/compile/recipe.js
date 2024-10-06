"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.build = void 0;
const vscode_1 = __importDefault(require("vscode"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const cp = __importStar(require("child_process"));
const utils_1 = require("../utils/utils");
const lw_1 = require("../lw");
const queue_1 = require("./queue");
const logger = lw_1.lw.log('Build', 'Recipe');
let prevRecipe = undefined;
let prevLangId = '';
setDockerImage();
lw_1.lw.onConfigChange('docker.image.latex', setDockerImage);
function setDockerImage() {
    const dockerImageName = vscode_1.default.workspace.getConfiguration('latex-workshop').get('docker.image.latex', '');
    logger.log(`Set $LATEXWORKSHOP_DOCKER_LATEX: ${JSON.stringify(dockerImageName)}`);
    process.env['LATEXWORKSHOP_DOCKER_LATEX'] = dockerImageName;
}
/**
 * Build LaTeX project using the recipe system. Creates Tools containing the
 * tool info and adds them to the queue. Initiates a buildLoop if there is no
 * running one.
 *
 * @param {string} rootFile - Path to the root LaTeX file.
 * @param {string} langId - The language ID of the root file. Used to determine
 * whether the previous recipe can be applied.
 * @param {Function} buildLoop - A function that represents the build loop.
 * @param {string} [recipeName] - Optional. The name of the recipe to be used.
 * If undefined, the builder tries to determine on its own.
 */
async function build(rootFile, langId, buildLoop, recipeName) {
    logger.log(`Build root file ${rootFile}`);
    // Save all open files in the workspace
    await vscode_1.default.workspace.saveAll();
    // Create build tools based on the recipe system
    const tools = createBuildTools(rootFile, langId, recipeName);
    // Create output subdirectories for included files
    if (tools?.map(tool => tool.command).includes('latexmk') && rootFile === lw_1.lw.root.subfiles.path && lw_1.lw.root.file.path) {
        createOutputSubFolders(lw_1.lw.root.file.path);
    }
    else {
        createOutputSubFolders(rootFile);
    }
    // Check for invalid toolchain
    if (tools === undefined) {
        logger.log('Invalid toolchain.');
        return;
    }
    // Add tools to the queue with timestamp
    const timestamp = Date.now();
    tools.forEach(tool => queue_1.queue.add(tool, rootFile, recipeName || 'Build', timestamp));
    lw_1.lw.compile.compiledPDFPath = lw_1.lw.file.getPdfPath(rootFile);
    // Execute the build loop
    await buildLoop();
}
exports.build = build;
/**
 * Create subdirectories of the output directory. This is necessary as some
 * LaTeX macros do not create the output directory themselves.
 *
 * @param {string} rootFile - Path to the root LaTeX file.
 */
function createOutputSubFolders(rootFile) {
    const rootDir = path_1.default.dirname(rootFile);
    let outDir = lw_1.lw.file.getOutDir(rootFile);
    if (!path_1.default.isAbsolute(outDir)) {
        outDir = path_1.default.resolve(rootDir, outDir);
    }
    logger.log(`outDir: ${outDir} .`);
    lw_1.lw.cache.getIncludedTeX(rootFile).forEach(file => {
        const relativePath = path_1.default.dirname(file.replace(rootDir, '.'));
        const fullOutDir = path_1.default.resolve(outDir, relativePath);
        // To avoid issues when fullOutDir is the root dir
        // Using fs.mkdir() on the root directory even with recursion will result in an error
        try {
            if (!(fs_1.default.existsSync(fullOutDir) && fs_1.default.statSync(fullOutDir).isDirectory())) {
                fs_1.default.mkdirSync(fullOutDir, { recursive: true });
            }
        }
        catch (e) {
            if (e instanceof Error) {
                // #4048
                logger.log(`Unexpected Error: ${e.name}: ${e.message} .`);
            }
            else {
                logger.log('Unexpected Error: please see the console log of the Developer Tools of VS Code.');
                logger.refreshStatus('x', 'errorForeground');
                throw (e);
            }
        }
    });
}
/**
 * Given an optional recipe, create the corresponding {@link Tool}s.
 *
 * @param {string} rootFile - Path to the root LaTeX file.
 * @param {string} langId - The language ID of the root file.
 * @param {string} [recipeName] - Optional. The name of the recipe to be used.
 * @returns {Tool[] | undefined} - An array of Tool objects representing the
 * build tools.
 */
function createBuildTools(rootFile, langId, recipeName) {
    let buildTools = [];
    const configuration = vscode_1.default.workspace.getConfiguration('latex-workshop', vscode_1.default.Uri.file(rootFile));
    const magic = findMagicComments(rootFile);
    if (recipeName === undefined && magic.tex && !configuration.get('latex.build.forceRecipeUsage')) {
        buildTools = createBuildMagic(rootFile, magic.tex, magic.bib);
    }
    else {
        const recipe = findRecipe(rootFile, langId, recipeName || magic.recipe);
        if (recipe === undefined) {
            return;
        }
        logger.log(`Preparing to run recipe: ${recipe.name}.`);
        prevRecipe = recipe;
        prevLangId = langId;
        const tools = configuration.get('latex.tools');
        recipe.tools.forEach(tool => {
            if (typeof tool === 'string') {
                const candidates = tools.filter(candidate => candidate.name === tool);
                if (candidates.length < 1) {
                    logger.log(`Skipping undefined tool ${tool} in recipe ${recipe.name}.`);
                    void logger.showErrorMessage(`Skipping undefined tool "${tool}" in recipe "${recipe.name}."`);
                }
                else {
                    buildTools.push(candidates[0]);
                }
            }
            else {
                buildTools.push(tool);
            }
        });
        logger.log(`Prepared ${buildTools.length} tools.`);
    }
    if (buildTools.length < 1) {
        return;
    }
    // Use JSON.parse and JSON.stringify for a deep copy.
    buildTools = JSON.parse(JSON.stringify(buildTools));
    populateTools(rootFile, buildTools);
    return buildTools;
}
/**
 * Find magic comments in the root file, including TeX and BibTeX programs, and
 * the LW recipe name.
 *
 * @param {string} rootFile - Path to the root LaTeX file.
 * @returns {{tex?: Tool, bib?: Tool, recipe?: string}} - An object containing
 * the TeX and BibTeX tools and the LW recipe name.
 */
function findMagicComments(rootFile) {
    const regexTex = /^(?:%\s*!\s*T[Ee]X\s(?:TS-)?program\s*=\s*([^\s]*)$)/m;
    const regexBib = /^(?:%\s*!\s*BIB\s(?:TS-)?program\s*=\s*([^\s]*)$)/m;
    const regexTexOptions = /^(?:%\s*!\s*T[Ee]X\s(?:TS-)?options\s*=\s*(.*)$)/m;
    const regexBibOptions = /^(?:%\s*!\s*BIB\s(?:TS-)?options\s*=\s*(.*)$)/m;
    const regexRecipe = /^(?:%\s*!\s*LW\srecipe\s*=\s*(.*)$)/m;
    let content = '';
    for (const line of fs_1.default.readFileSync(rootFile).toString().split('\n')) {
        if (line.startsWith('%') || line.trim().length === 0) {
            content += line + '\n';
        }
        else {
            break;
        }
    }
    const tex = content.match(regexTex);
    let texCommand = undefined;
    if (tex) {
        texCommand = {
            name: lw_1.lw.constant.TEX_MAGIC_PROGRAM_NAME,
            command: tex[1]
        };
        logger.log(`Found TeX program by magic comment: ${texCommand.command}.`);
        const res = content.match(regexTexOptions);
        if (res) {
            texCommand.args = [res[1]];
            logger.log(`Found TeX options by magic comment: ${texCommand.args}.`);
        }
    }
    const bib = content.match(regexBib);
    let bibCommand = undefined;
    if (bib) {
        bibCommand = {
            name: lw_1.lw.constant.BIB_MAGIC_PROGRAM_NAME,
            command: bib[1]
        };
        logger.log(`Found BIB program by magic comment: ${bibCommand.command}.`);
        const res = content.match(regexBibOptions);
        if (res) {
            bibCommand.args = [res[1]];
            logger.log(`Found BIB options by magic comment: ${bibCommand.args}.`);
        }
    }
    const recipe = content.match(regexRecipe);
    if (recipe && recipe[1]) {
        logger.log(`Found LW recipe '${recipe[1]}' by magic comment: ${recipe}.`);
    }
    return { tex: texCommand, bib: bibCommand, recipe: recipe?.[1] };
}
/**
 * Create build tools based on magic comments in the root file.
 *
 * @param {string} rootFile - Path to the root LaTeX file.
 * @param {Tool} magicTex - Tool object representing the TeX command from magic
 * comments.
 * @param {Tool} [magicBib] - Optional. Tool object representing the BibTeX
 * command from magic comments.
 * @returns {Tool[]} - An array of Tool objects representing the build tools.
 */
function createBuildMagic(rootFile, magicTex, magicBib) {
    const configuration = vscode_1.default.workspace.getConfiguration('latex-workshop', vscode_1.default.Uri.file(rootFile));
    if (!magicTex.args) {
        magicTex.args = configuration.get('latex.magic.args');
        magicTex.name = lw_1.lw.constant.TEX_MAGIC_PROGRAM_NAME + lw_1.lw.constant.MAGIC_PROGRAM_ARGS_SUFFIX;
    }
    if (magicBib) {
        if (!magicBib.args) {
            magicBib.args = configuration.get('latex.magic.bib.args');
            magicBib.name = lw_1.lw.constant.BIB_MAGIC_PROGRAM_NAME + lw_1.lw.constant.MAGIC_PROGRAM_ARGS_SUFFIX;
        }
        return [magicTex, magicBib, magicTex, magicTex];
    }
    else {
        return [magicTex];
    }
}
/**
 * Find a recipe based on the provided recipe name, language ID, and root file.
 *
 * @param {string} rootFile - Path to the root LaTeX file.
 * @param {string} langId - The language ID of the root file.
 * @param {string} [recipeName] - Optional. The name of the recipe to be used.
 * @returns {Recipe | undefined} - The Recipe object corresponding to the
 * provided parameters.
 */
function findRecipe(rootFile, langId, recipeName) {
    const configuration = vscode_1.default.workspace.getConfiguration('latex-workshop', vscode_1.default.Uri.file(rootFile));
    const recipes = configuration.get('latex.recipes');
    const defaultRecipeName = configuration.get('latex.recipe.default');
    if (recipes.length < 1) {
        logger.log('No recipes defined.');
        void logger.showErrorMessage('[Builder] No recipes defined.');
        return;
    }
    if (prevLangId !== langId) {
        prevRecipe = undefined;
    }
    let recipe;
    // Find recipe according to the given name
    if (recipeName === undefined && !['first', 'lastUsed'].includes(defaultRecipeName)) {
        recipeName = defaultRecipeName;
    }
    if (recipeName) {
        recipe = recipes.find(candidate => candidate.name === recipeName);
        if (recipe === undefined) {
            logger.log(`Failed to resolve build recipe: ${recipeName}.`);
            void logger.showErrorMessage(`[Builder] Failed to resolve build recipe: ${recipeName}.`);
        }
    }
    // Find default recipe of last used
    if (recipe === undefined && defaultRecipeName === 'lastUsed' && recipes.find(candidate => candidate.name === prevRecipe?.name)) {
        recipe = prevRecipe;
    }
    // If still not found, fallback to 'first'
    if (recipe === undefined) {
        let candidates = recipes;
        if (langId === 'rsweave') {
            candidates = recipes.filter(candidate => candidate.name.toLowerCase().match('rnw|rsweave'));
        }
        else if (langId === 'jlweave') {
            candidates = recipes.filter(candidate => candidate.name.toLowerCase().match('jnw|jlweave|weave.jl'));
        }
        else if (langId === 'pweave') {
            candidates = recipes.filter(candidate => candidate.name.toLowerCase().match('pnw|pweave'));
        }
        if (candidates.length < 1) {
            logger.log(`Failed to resolve build recipe: ${recipeName}.`);
            void logger.showErrorMessage(`Failed to resolve build recipe: ${recipeName}.`);
        }
        recipe = candidates[0];
    }
    return recipe;
}
/**
 * Expand the bare {@link Tool} with Docker and argument placeholder strings.
 *
 * @param {string} rootFile - Path to the root LaTeX file.
 * @param {Tool[]} buildTools - An array of Tool objects to be populated.
 * @returns {Tool[]} - An array of Tool objects with expanded values.
 */
function populateTools(rootFile, buildTools) {
    const configuration = vscode_1.default.workspace.getConfiguration('latex-workshop', vscode_1.default.Uri.file(rootFile));
    const docker = configuration.get('docker.enabled');
    buildTools.forEach(tool => {
        if (docker) {
            switch (tool.command) {
                case 'latexmk':
                    logger.log('Use Docker to invoke the command.');
                    if (process.platform === 'win32') {
                        tool.command = path_1.default.resolve(lw_1.lw.extensionRoot, './scripts/latexmk.bat');
                    }
                    else {
                        tool.command = path_1.default.resolve(lw_1.lw.extensionRoot, './scripts/latexmk');
                        fs_1.default.chmodSync(tool.command, 0o755);
                    }
                    break;
                default:
                    logger.log(`Do not use Docker to invoke the command: ${tool.command}.`);
                    break;
            }
        }
        tool.args = tool.args?.map((0, utils_1.replaceArgumentPlaceholders)(rootFile, lw_1.lw.file.tmpDirPath));
        lw_1.lw.file.setTeXDirs(rootFile, tool.args?.filter(arg => arg.startsWith('-out-directory') || arg.startsWith('-outdir'))[0]?.replace(/^-out-directory=|^-outdir=/, ''), tool.args?.filter(arg => arg.startsWith('-aux-directory') || arg.startsWith('-auxdir'))[0]?.replace(/^-aux-directory=|^-auxdir=/, ''));
        const env = tool.env ?? {};
        Object.entries(env).forEach(([key, value]) => {
            env[key] = value && (0, utils_1.replaceArgumentPlaceholders)(rootFile, lw_1.lw.file.tmpDirPath)(value);
        });
        if (configuration.get('latex.option.maxPrintLine.enabled')) {
            tool.args = tool.args ?? [];
            const isLuaLatex = tool.args.includes('-lualatex') ||
                tool.args.includes('-pdflua') ||
                tool.args.includes('-pdflualatex') ||
                tool.args.includes('--lualatex') ||
                tool.args.includes('--pdflua') ||
                tool.args.includes('--pdflualatex');
            if (isMikTeX() && ((tool.command === 'latexmk' && !isLuaLatex) || tool.command === 'pdflatex')) {
                tool.args.unshift('--max-print-line=' + lw_1.lw.constant.MAX_PRINT_LINE);
            }
        }
    });
    return buildTools;
}
let _isMikTeX;
/**
 * Check whether the LaTeX toolchain compilers are provided by MikTeX.
 *
 * @returns {boolean} - True if the LaTeX toolchain is provided by MikTeX;
 * otherwise, false.
 */
function isMikTeX() {
    if (_isMikTeX === undefined) {
        try {
            if (cp.execSync('pdflatex --version').toString().match(/MiKTeX/)) {
                _isMikTeX = true;
                logger.log('`pdflatex` is provided by MiKTeX.');
            }
            else {
                _isMikTeX = false;
            }
        }
        catch (e) {
            logger.log('Cannot run `pdflatex` to determine if we are using MiKTeX.');
            _isMikTeX = false;
        }
    }
    return _isMikTeX;
}
//# sourceMappingURL=recipe.js.map