import fs from "fs";
import events from "events";
import readline from "readline";
import { config } from "dotenv";
import path from "path";
import inquirer from "inquirer";
import * as url from "url";
import { ResponseActionHandler, ModuleInfoInterface, ActivityInterface, ActionChoiceInterface } from "./types.js";

const __dirname = url.fileURLToPath(new URL('.', import.meta.url));

config({ path: path.resolve(__dirname, "..", ".env") });

const printActivities: ResponseActionHandler = function (module, activities) {
  const output = activities.reduce((output, { slack }) => {
    output += slack + "\n";
    return output;
  }, "\n");
  console.log(output);
}

function copyRecursive(src: string, dest: string, options: { include?: RegExp, excludeDir?: RegExp, excludeFile?: RegExp } = {}) {
  const stat = fs.lstatSync(src);
  console.log("FILE SRC: ", src);
  console.log("FILE DES: ", dest);
  console.log();
  if (stat.isDirectory()) {
    if (options.excludeDir?.test(src)) {
      return;
    }

    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }

    if (src.toLowerCase().includes("solved")) {
      console.log(fs.readdirSync(src));
    }

    for (const file of fs.readdirSync(src)) {
      
      const newSrc = path.join(src, file);
      if (!options.include || options.include.test(newSrc)) {
        // console.log(path.join(dest, file));
        copyRecursive(newSrc, path.join(dest, file), options);
      }
    }

  } else if (stat.isFile() && !options.excludeFile?.test(src)) {
    fs.copyFileSync(src, dest);
  }
}

function getModuleDirectory(module: ModuleInfoInterface): { path: string; found: string } {
  let moduleDir = path.join(process.env.CURRICULUM_ROOT!, "01-Class-Content");
  const modules = fs.readdirSync(moduleDir);
  const prefix = module.module.substring(-2, 3);
  const found = modules.find((name) => name.substring(-2, 3) === prefix);
  if (!found) {
    console.log(`Could not find module for lesson plan ${module.module}`);
    process.exit(1);
  }

  return { path: path.join(moduleDir, found!), found };
}

const copyModule: ResponseActionHandler = async function (module) {
  const { path: _path, found } = getModuleDirectory(module);

  for (const file of fs.readdirSync(_path)) {
    const dest = path.join(process.env.CLASS_REPO_ROOT!, found, file);
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    copyRecursive(path.join(_path, file), dest, { excludeDir: /node_modules|\/solved|\/[0-9].*\/main/gi, excludeFile: /.ds_store|.env/gi });
  }

  return;
}

const copySolutions: ResponseActionHandler = async function (module, activities) {
  const _module = getModuleDirectory(module);
  const activityModule = path.join(process.env.CLASS_REPO_ROOT!, _module.found);
  const prefixes = activities.reduce<Record<string, boolean>>((acc, act) => {
    acc[act.activity.substring(-2, 3)] = true;
    return acc;
  }, {});

  if (!fs.existsSync(activityModule)) {
    console.error(`Module '${_module.found}' has not been copied over to class repo. Run '${choices.copyModule.name}' first.`);
    return;
  }

  const activityRegex = /activities/gi;

  for (const file of fs.readdirSync(_module.path)) {
    const dest = path.join(process.env.CLASS_REPO_ROOT!, _module.found, file);
    const src = path.join(_module.path, file);

    if (fs.statSync(src).isFile()) {
      continue;
    }

    for (const activityDir of fs.readdirSync(src)) {
      const activity = path.join(src, activityDir);
      if (
        !activityRegex.test(activity) ||
        !prefixes[activityDir.substring(-2, 3)] ||
        fs.statSync(activity).isFile()
      ) {
        continue;
      }

      // console.group("Activity");
      // console.log(activity);
      // console.groupEnd();
      for (const innerDir of fs.readdirSync(activity)) {
        const innerSrc = path.join(activity, innerDir);
        if (fs.statSync(innerSrc).isFile()) {
          continue;
        }
        copyRecursive(innerSrc, path.join(dest, activityDir, innerDir), {
          include: /\/solved|\/main/gi,
          excludeDir: /node_modules|unsolved/gi,
          excludeFile: /.ds_store|.env/gi,
        });
      }
    }

  }

  const algoSrc = path.join(_module.path, "03-Algorithms");
  if (module.day.substring(-2, 2) !== "03" || !fs.existsSync(algoSrc) || !fs.statSync(algoSrc).isDirectory()) {
    return;
  }
  const dest = path.join(process.env.CLASS_REPO_ROOT!, _module.found);
  for (const algoDir of fs.readdirSync(algoSrc)) {
    const activity = path.join(algoSrc, algoDir);
    if (!fs.statSync(activity).isDirectory()) {
      continue;
    }
    for (const category of fs.readdirSync(activity)) {
      const categoryPath = path.join(activity, category);
      if ((/\/solved/gi).test(categoryPath)) {
        fs.cpSync(categoryPath, path.join(dest, algoDir, category));
      }
    }
  }

  return;
}

async function readActivities(path: string) {
  try {
    const rl = readline.createInterface({
      input: fs.createReadStream(path),
      crlfDelay: Infinity
    });

    const durationRegex = /\. (student|everyone) do:.*(\([\d]+ min\))/i;
    const fileRegex = /`[\d]+-(stu|evr)_.+\/.+`/i;

    const activities: ActivityInterface[] = [];

    let duration = "";

    rl.on("line", (line) => {
      if (!duration) {
        const match = line.match(durationRegex);
        if (match && match[2]) {
          duration = match[2];
          return;
        } else {
          duration = "";
          return;
        }
      }

      const match = line.match(fileRegex);
      if (match) {
        activities.push({
          slack: `Activity ${match[0]} ${duration}`,
          activity: match[0].replaceAll(/`|\/README.md/g, ""),
        });
        duration = "";
      }
    });

    await events.once(rl, "close");
    return activities;
  } catch (err) {
    console.error(err);
    throw err;
  }

}

function checkEnvironmentVariables() {
  const envs = ["LESSON_PLANS_ROOT", "CURRICULUM_ROOT", "CLASS_REPO_ROOT"];
  let valid = true;
  for (const env of envs) {
    if (!process.env[env]) {
      console.error(`Environment variable '${env}' required!`);
      valid = false;
    }
  }
  if (!valid) {
    process.exit(1);
  }
}

async function getLessonPlan(action: string | number): Promise<ModuleInfoInterface> {
  let filePath = process.env.LESSON_PLANS_ROOT!;

  const response = await inquirer.prompt([
    {
      type: "list",
      name: "lessonPlan",
      message: "choose a curriculum",
      choices: function () {
        const regex = /-time/i
        return fs.readdirSync(filePath!).filter((dir) => !!dir.match(regex)).reverse();
      },
    },
    {
      type: "list",
      name: "module",
      message: "choose a module",
      choices: function (answers) {
        filePath = path.join(filePath, answers.lessonPlan);
        return fs.readdirSync(filePath);
      }
    },
    {
      type: "list",
      name: "day",
      message: "choose a lesson plan",
      choices: function (answers) {
        filePath = path.join(filePath, answers.module);
        return fs.readdirSync(filePath);
      },
      when: () => {
        return action !== choices.copyModule.value;
      }
    }
  ]);


  if (response.day) {
    filePath = path.join(filePath, response.day);
    const dir = fs.readdirSync(filePath);
    const file = dir.filter((name) => name.match(/lesson[-_]plan|lessonplan/gi))[0];
    if (!file) {
      console.log("UNABLE TO FIND LESSON PLAN");
      process.exit(1);
    }
    response.lessonPlan = path.join(filePath, file);
  } else {
    response.lessonPlan = path.join(filePath, response.module);
  }

  return response;
}

const choices: Record<string, ActionChoiceInterface> = {
  copyLessonSolutions: {
    name: "Copy Lesson Solutions",
    value: "copyLessonSolutions",
    call: copySolutions,
  },
  copyModule: {
    name: "Copy Module - Strip solutions",
    value: "copyModule",
    call: copyModule,
  },
  printActivities: {
    name: "Print Activities",
    value: "printActivities",
    call: printActivities,
  },
};

async function getAction(): Promise<keyof typeof choices> {
  const { action } = await inquirer.prompt([
    {
      name: "action",
      type: "list",
      message: "Choose an option.",
      choices: Object.values(choices),
    },
  ]);
  return action;
}

async function init() {
  checkEnvironmentVariables();
  const action = await getAction();
  const module = await getLessonPlan(action);
  let activities: ActivityInterface[] = [];

  if (action !== choices.copyModule.value) {
    activities = await readActivities(module.lessonPlan);
  }
  
  choices[action].call(module, activities);
}

init();
