import { Command } from 'commander';
import sass from 'sass';
import path from 'path';
import fs from 'fs';
import glob from 'glob';
import {optimize as svgOptimize} from 'svgo';
import replaceInFile from 'replace-in-file';
import minify from 'html-minifier';
import * as marked from 'marked';

const program = new Command();

let SASS_FILE_EXTENSION = '.scss';


const processContants = (config)=>{
    SASS_FILE_EXTENSION = config.constants?.sass_file_extension || '.scss';
}

// Returns an array of replacement objects.
// Each replacement object contains a from and to entry.
const getReplacements = (config, is_debug)=>{
    let replacements = [];

    if(config.common?.replacements !== undefined){
        config.common.replacements.forEach((obj)=>{
            replacements.push(obj);
        });
    }
    if (is_debug) {
        if (config.debug?.replacements !== undefined) {
            config.debug.replacements.forEach((obj) => {
                replacements.push(obj);
            });
        }
    }
    else{
        if (config.release?.replacements !== undefined) {
            config.release.replacements.forEach((obj) => {
                replacements.push(obj);
            });
        }
    }

    return replacements;
}

// A list of the possible actions that can be performed.
// Each action takes either 2 parameters:
//   -output_files: A list of files to be output. The first entry is always the contents of
//                  either the input file or the previous action. The other entries are
//                  additional files to be output (such as map files).
//
//   -options:      An object which contains a action_options object for action specific
//                  options and the replacements array.
const ACTION_LIST = {
    compile_sass: (output_files, options)=>{
        let input_file = output_files[0];

        const result = sass.compile(input_file.source, options.action_options || {});
        input_file.contents = result.css;
        if(options.action_options?.sourceMap !== undefined && options.action_options.sourceMap){
            output_files.push({
               dest: input_file.dest + ".map",
               contents: JSON.stringify(result.sourceMap)
            });
        }
    },
    optimize_svg: (output_files, options)=>{
        output_files[0].contents = svgOptimize(output_files[0].contents, options.action_options || {}).data;
    },
    minify_html: (output_files, options)=>{
        output_files[0].contents = minify.minify(output_files[0].contents, options.action_options || {});
    },
    replacement: (output_files, options)=>{
        options.replacements.forEach((replacement)=>{
            output_files[0].contents = output_files[0].contents.replaceAll(replacement.from, replacement.to);
        });
    },
    // Requires that action_options has both a template member containing the filepath of the template to use
    // and an insertion_point member containing the string in the template that should be replaced with
    // the contents of the source file.
    insert_into_template: (output_files, options)=>{
        let template_file = fs.readFileSync(options.action_options.template).toString();
        output_files[0].contents = template_file.replaceAll(options.action_options.insertion_point, output_files[0].contents);
    },
    compile_markdown: (output_files, options)=>{
        output_files[0].contents = marked.parse(output_files[0].contents);
    },
    // Requires that action_options has both a from and to member the same as a replacement object
    change_output_extension: (output_files, options)=>{
        output_files.forEach((output_file)=>{
            if(output_file.dest.endsWith(options.action_options.from)){
                output_file.dest = output_file.dest.slice(0, - options.action_options.from.length) + options.action_options.to;
            }
        });
    }
}

// Given the source and destination file, load the file and perform
// the configured actions on the source file before outputting the
// result to the destination.
const performActionsOnPath = (source, dest, actions, replacements)=>{
    // if no actions are specified the default is a copy,
    // so perform the copy via the filesystem instead of loading
    // the contents and then writing them back out.
    if(actions === undefined || actions.length == 0){
        fs.copyFileSync(source, dest);
        return;
    }

    let output_files = [{"source": source, "dest": dest, "contents": fs.readFileSync(source).toString()}];
    actions.forEach((action)=>{
        // Create a combined options object from the action options and the replacements
        const options = {action_options: action.options, replacements: replacements};

        if(action.action in ACTION_LIST) ACTION_LIST[action.action](output_files, options);
    })
    output_files.forEach((file)=>{
        fs.mkdirSync(path.dirname(file.dest), {recursive: true});
        fs.writeFileSync(file.dest, file.contents);
    })
}
const performActionsOnPaths = (build_path, replacements, paths)=>{
    paths.forEach((obj)=>{
        if(obj.type === "file"){
            performActionsOnPath(obj.source, path.join(build_path, obj.dest), obj.actions, replacements);
        }
        else if(obj.type === "directory"){
            glob.sync(`${obj.source}${path.sep}**${path.sep}*`).forEach((file)=>{
                performActionsOnPath(file, path.join(build_path, obj.dest, file.slice(obj.source.length)), obj.actions, replacements);
            });
        }
        else{
            console.log(`Unknown path type for path ${obj.source}`);
        }
    });
}

const build = (build_path, options)=>{
    const config = JSON.parse(fs.readFileSync(options.config).toString());
    processContants(config);

    const replacements = getReplacements(config, options.debug);

    if(config?.common?.paths !== undefined)
        performActionsOnPaths(build_path, replacements, config.common.paths);
    if(config?.debug?.paths !== undefined && options.debug)
        performActionsOnPaths(build_path, replacements, config.debug.paths);
    if(config?.release?.paths !== undefined && !options.debug)
        performActionsOnPaths(build_path, replacements, config.release.paths);
};


program
    .argument('<path>', 'output path for the build')
    .option('-d, --debug', "Specify that this is a debug build", false)
    .option('-c, --config', "Specify the config file to use for the build.", "build_config.json")
    .action(build);
program.parse();