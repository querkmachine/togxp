const qs = require("querystring");
const fetch = require("node-fetch");
const moment = require("moment");
const fs = require("fs");
const {promisify} = require('util');
const path = require("path");

const API_PASSWORD = "api_token";
const ENDPOINT = "https://toggl.com/reports/api/v2/details";
const USER_AGENT = "stuart.watson@felinesoft.com";
const HEADERS = ["Name","Start Time","Hours","Time Spent","Category","Owner","Case","Order","Opportunity","Quote","Invoice"];
const VALID_CATS = [
    "Deployment",
    "Infrastructure",
    "User Support / Configuration",
    "Development / Sprint",
    "Information Architecture / Business Analysis",
    "Knowledge Transfer",
    "Project Management",
    "Sales & Marketing",
    "Specification / Planning / Researching",
    "Strategic",
    "Testing",
    "Training",
    "Travel",
    "Strategy",
    "Support"
]

let API_KEY = null;
let WORKSPACE = null;
let USERNAME = null;
let DEFAULT_LOC = null;
let HALT_ON_MISSING = false;
/** @type {({Project?:(string|RegExp),Client?:(string|RegExp),Ignore?:boolean,Order?:string,Opportunity?:string,Category?:string})[]} */
let PROJECT_CONFIGS = null;

async function LoadConfig(){
    const rawConfig = await promisify(fs.readFile)(path.join(__dirname,"config.json"));
    const config = JSON.parse(rawConfig);

    API_KEY = config.Toggl.ApiKey;
    WORKSPACE = config.Toggl.Workspace;

    USERNAME = config.Crm.Username;
    DEFAULT_LOC = config.Output.DefaultLocation;

    if ("HaltOnMissing" in config.Settings){
        HALT_ON_MISSING = config.Settings.HaltOnMissing;
    }

    PROJECT_CONFIGS = config.Projects.map((input,i) => {
        var copy = {...input};
        if ("ProjectRegex" in copy){
            copy.Project = new RegExp(input.ProjectRegex);
            delete copy.ProjectRegex;
        }
        if ("ClientRegex" in copy){
            copy.Client = new RegExp(input.ClientRegex);
            delete copy.ClientRegex;
        }
        if(!("Order" in copy) && !("Opportunity" in copy)){
            throw `Bad configuration, Rule {i} lacks either Order or Opportunity`;
        }
        return copy;
    });

}

/**
 * Checks if a test is true, or missing
 * @param {string|RegExp} test The test to run
 * @param {string} against The string to test against
 */
function CheckTest(test,against){
    return !test || (test.test && test.test(against)) || test === against;
}

/**
 * Looks up the given project & client in the config, and returns the Order and default category.
 * If multiple match the first is returned
 * @param {string} project 
 */
function getOrderAndCategoryForProject(project,client){
    for (config of PROJECT_CONFIGS){
        if ( CheckTest(config.Project,project) && CheckTest(config.Client,client) ){
            return {
                order:config.Order||"",
                opportunity:config.Opportunity||"",
                category:config.Category
            }
        }
    }
}

/**
 * Extracts the case and category from a description. 
 * 
 * The category needs to be one of {@linkcode VALID_CATS} and surrounded by square brackets.
 * The Case number needs to start with "CAS-".
 * 
 * If present, they need to be at the start of the string, separated only by white space, in any order.
 * Any remaining description is returned as the description.
 * @param {string} description The description string to parse
 */
function parseDescription(description){
    let cas = "";
    let category = "";
    
    while (description){
        description = description.trim();

        if (!category && description.startsWith("[")){
            let brk = description.indexOf("]");
            if(brk == -1){
                throw `Missing ']' from ${description}`;
            }
            let enteredCat = description.substring(1,brk).toLowerCase();

            description = description.substring(brk+1);
            category = VALID_CATS.find(x=>x.toLowerCase() == enteredCat);

            if(category === undefined){
                throw `Unrecognized category ${enteredCat}`;
            }
        } else if (!cas && description.startsWith("CAS-")){
            let brk = description.indexOf(" ");
            if (brk == -1){
                cas = description;
                description = "";
            }
            cas = description.substring(0,brk);
            description = description.substring(brk+1);
        } else {
            break;
        }
    }
    return {cas,description,category};
}

async function getAllPages(start,end){
    let result = {data:[null]}
    const allResults = [];

    for(let page=1; result.data.length != 0; page++){
        const query = ENDPOINT + "?" + qs.stringify({
            user_agent:USER_AGENT,
            workspace_id:WORKSPACE,
            since:start,
            until:end,
            page
        });
        const headers = {
            Authorization:"Basic "+Buffer.from(API_KEY+":"+API_PASSWORD).toString("base64")
        }
        const fetchResult = await fetch(query,{headers});
        result = await fetchResult.json();

        if(result.error){
            throw result.error;
        }

        allResults.push(...result.data);
    }
    return allResults;
}

async function getFromToggle({since,until}){
    //let start = moment().add(-weeksAgo,"weeks").startOf('isoWeek').format("YYYY-MM-DD")
    //let end = moment().add(-weeksAgo,"weeks").endOf('isoWeek').format("YYYY-MM-DD")
    let start = since? since: moment().startOf("isoWeek").format("YYYY-MM-DD");
    let end = until? until: moment().format("YYYY-MM-DD");

    console.log(`From ${start} until ${end} (both inclusive)`);

    let result = await getAllPages(start,end);

    let output = [HEADERS];


    for (let r of result){
        let start = new Date(r.start);
        let end = new Date(r.end);
        let durationMin = Math.round((end-start)/(1000*60));
        let order, defaultCat;
        try {
            let config = getOrderAndCategoryForProject(r.project,r.client);
            order = config.order;
            defaultCat = config.category;
            opportunity = config.opportunity
        } catch (e){
            console.error(`Cannot match for project:client for "${r.project}":"${r.client}", used by time slot at "${start}". Add to config to process`);
            if(HALT_ON_MISSING){
                console.error("Project is set to halt on missing config. Aborting.")
                throw e;
            }
            continue;
        }
        let {cas,description,category} = parseDescription(r.description);

        if(description == ""){
            description = r.project? `(Undescribed ${r.project} work)`: "(Undescribed work)";
        }
        if(category == ""){
            category = defaultCat;
        }
        
        output.push([
            description,
            r.start,
            (durationMin/60).toFixed(2),
            durationMin,
            category,
            USERNAME,
            cas,
            order,
            opportunity, //Opportunity
            "", //Quote
            "" //Invoice
        ])
    }
    return output;
}

function help(){
    console.log(
`Toggle -> CRM formatted 
    --help:
        show this text and exit
    --since/--until format:yyyy-mm-dd
        sets the dates to run between, both inclusive
        defaults: start of the week; today.
    --today:
        sets --since and --until to today
    --yesterday:
        sets --since and --until to yesterday
    --outfile:
        sets where to output
        if blank: "${DEFAULT_LOC}" is used
        if omitted: prints to stdout only
`)
}

async function run(){
    var ops = {};

    await LoadConfig();

    for(let i=2;i<process.argv.length;i++){
        let input = process.argv[i];
        switch (input){
            case "--help":
                return help();
            case "--today":
                ops.since = moment().format("YYYY-MM-DD");
                ops.until = ops.since;
                break;
            case "--yesterday":
                ops.since = moment().add(-1,"day").format("YYYY-MM-DD");
                ops.until = ops.since;
                break;
            case "--days-ago":
                let arg = process.argv[++i].split("-",2);
                ops.since = moment().subtract(arg[0],"days").format("YYYY-MM-DD");
                ops.until = arg.length == 2? moment().subtract(arg[1],"days").format("YYYY-MM-DD"):ops.since;
                break;
            case "--since":
            case "--until":
            case "--outfile":
                if (process.argv.length != i+1 && !process.argv[i+1].startsWith("-")){
                    ops[input.substr(2)] = process.argv[++i];
                } else {
                    console.log(`using defualt out file ${DEFAULT_LOC}`)
                    ops[input.substr(2)] = DEFAULT_LOC;
                }
                break;
            default:
                console.error(`unknown input ${input}`);
        }
    }

    let result = await getFromToggle(ops);

    const out = ops.outfile? fs.createWriteStream(ops.outfile) : process.stdout;
    const writeOut = promisify(out.write.bind(out))

    let totalMins = 0;
    let isHeader = true;

    for(row of result){
        await writeOut(row.map(n=>typeof(n) == "string"? `"${n.replace(/"/g,'""')}"`:n).join(",")+"\n");
        if(!isHeader){
            totalMins += row[3]
        } else {
            isHeader = false;
        }
    }
    console.log(`${result.length-1} row(s) produced`);
    console.log(`Total hours worked: ${(totalMins/60).toFixed(2)}`)
    process.exit();
}

run().then(console.log,console.error)
