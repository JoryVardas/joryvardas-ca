import { Command } from 'commander';
import sass from 'sass';
import path from 'path';
import fs from 'fs';
import glob from 'glob';
import {optimize as svgOptimize} from 'svgo';
import replaceInFile from 'replace-in-file';
import minify from 'html-minifier';

const program = new Command();

let SASS_FILE_EXTENSION = '.scss';

const compileSassFile = (input_file_path, output_directory, is_debug)=>{
    if (!fs.existsSync(output_directory)) fs.mkdirSync(output_directory, {recursive: true});

    const file_name = path.basename(input_file_path, SASS_FILE_EXTENSION);
    const result = sass.compile(input_file_path, {style: is_debug ? 'expanded' : 'compressed', sourceMap: true});
    fs.writeFileSync(`${output_directory}${path.sep}${file_name}.css`, result.css);
    if(is_debug){
        fs.writeFileSync(`${output_directory}${path.sep}${file_name}.css.map`, JSON.stringify(result.sourceMap));
    }
}
const compileAllSassFiles = (input_directory, output_directory, is_debug)=>{
    const files = glob.sync(`${input_directory}${path.sep}**${path.sep}*${SASS_FILE_EXTENSION}`);
    files.forEach((file)=>{
        //file will always start with input_directory, so remove the input directory
        const file_name = path.basename(file);
        const new_output_directory = path.join(output_directory,file.slice(input_directory.length, -file_name.length));
        compileSassFile(file, new_output_directory, is_debug);
    });
}

const optimizeSvg = (input_file, output_file)=>{
    const result = svgOptimize(fs.readFileSync(input_file), {
        path: input_file,
        multipass: true,
    });
    fs.writeFileSync(output_file, result.data);
}
const copyImages = (input_directory, output_directory, is_debug)=>{
    const files = glob.sync(`${input_directory}${path.sep}**${path.sep}*`);
    files.forEach((file)=>{
        //file will always start with input_directory, so remove the input directory
        const file_name = path.basename(file);
        const new_output_directory = path.join(output_directory,file.slice(input_directory.length, -file_name.length));
        const new_file_name = path.join(new_output_directory, file_name);

        if (!fs.existsSync(new_output_directory)) fs.mkdirSync(new_output_directory, {recursive: true});

        if(file_name.endsWith('.svg') && is_debug) optimizeSvg(file, new_file_name);
        else fs.copyFileSync(file, new_file_name);
    });
}

const processContants = (config)=>{
    SASS_FILE_EXTENSION = config.constants?.sass_file_extension || '.scss';
}
const processStyles = (build_path, config, is_debug)=>{
    if(config.style?.sass_paths !== undefined){
        config.style.sass_paths.forEach((obj)=>{
            compileAllSassFiles(obj.source, path.join(build_path, obj.dest), is_debug);
        })
    }
}
const processImages = (build_path, config, is_debug)=>{
    if(config.image?.image_paths !== undefined){
        config.image.image_paths.forEach((obj)=>{
            copyImages(obj.source, path.join(build_path, obj.dest), is_debug);
        })
    }
}
const getReplacements = (config, is_debug)=>{
    let replacements_from = [];
    let replacements_to = [];

    if(config.html?.common?.replacements !== undefined){
        config.html.common.replacements.forEach((obj)=>{
            replacements_from.push(obj.from);
            replacements_to.push(obj.to);
        });
    }
    if (is_debug) {
        if (config.html?.debug?.replacements !== undefined) {
            config.html.debug.replacements.forEach((obj) => {
                replacements_from.push(obj.from);
                replacements_to.push(obj.to);
            });
        }
    }
    else{
        if (config.html?.release?.replacements !== undefined) {
            config.html.release.replacements.forEach((obj) => {
                replacements_from.push(obj.from);
                replacements_to.push(obj.to);
            });
        }
    }

    return [replacements_from, replacements_to];
}
const processHtml = (build_path, config, is_debug)=>{
    if(config.html?.html_paths !== undefined){
        const [replacements_from, replacements_to] = getReplacements(config, is_debug);

        config.html.html_paths.forEach((obj)=>{
            const dest_directory = path.join(build_path, path.dirname(obj.dest));
            if(!fs.existsSync(dest_directory)) fs.mkdirSync(dest_directory,  {recursive: true});
            const new_file_path = path.join(dest_directory, path.basename(obj.dest));

            if(is_debug){
                fs.copyFileSync(obj.source, new_file_path);
            }
            else{
                const result = minify.minify(fs.readFileSync(obj.source).toString(), config.html?.release?.minify_settings || {});
                fs.writeFileSync(new_file_path, result);
            }

            replaceInFile.sync({files: new_file_path, from: replacements_from, to: replacements_to});
        })
    }
}
const copyFilesInList = (build_path, file_array) => {
    file_array.forEach((obj)=>{
        fs.copyFileSync(obj.source, path.join(build_path, obj.dest));
    });
}
const processFileToCopy = (build_path, config, is_debug)=>{
    if(config.files_to_copy?.common !== undefined){
        copyFilesInList(build_path, config.files_to_copy.common);
    }
    if(is_debug) {
        if (config.files_to_copy?.debug !== undefined) {
            copyFilesInList(build_path, config.files_to_copy.debug);
        }
    }
    else {
        if (config.files_to_copy?.release !== undefined) {
            copyFilesInList(build_path, config.files_to_copy.release);
        }
    }
}

const build = (build_path, options)=>{
    const config = JSON.parse(fs.readFileSync(options.config).toString());
    processContants(config);
    processStyles(build_path, config, options.debug);
    processImages(build_path, config, options.debug);
    processHtml(build_path, config, options.debug);
    processFileToCopy(build_path, config, options.debug);
};


program
    .argument('<path>', 'output path for the build')
    .option('-d, --debug', "Specify that this is a debug build", false)
    .option('-c, --config', "Specify the config file to use for the build.", "build_config.json")
    .action(build);
program.parse();