const request = require('request-promise-native');
const rootUrl = "https://xrm.felinesoft.com";

let topCookies = []

/**
 * 
 * @param {string} type The type of CRM element to query
 * @param {string} select The property to return
 * @param {string} filterBy The property to filter by
 * @param {string[]} options The options to use for filtering
 */
function query(type,select,filterBy,options){
    let filter = options.map(x=>`${filterBy} eq '${x}'`).join(" or ");

    r =  request({
        method:"GET",
        uri:`${rootUrl}/XRMServices/2011/OrganizationData.svc/${type}Set`,
        qs:{
            "$select": `${select},${filterBy}`,
            "$filter": filter
        },
        headers:{
            "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/74.0.3729.157 Safari/537.36",
            "Cookie": topCookies.join("; ")
        },
        json: true
        //,jar: cookieJar
    })
    
    return r.then(results=>{
        let map = {};
        for(let r of results.d.results){
            map[r[filterBy]] = r[select];
        }
        return map;
    });
}

async function auth(){
    let cookies = await require("./electronLogin.js")("https://xrm.felinesoft.com",["MSISAuth","MSISAuth1"]);
    topCookies = cookies.map(x=>`${x.name}=${x.value}`)
}

module.exports = {auth,queryCache};

const CACHE = {};
/**
 * 
 * @param {string} type 
 * @param {string} select 
 * @param {string} filterBy 
 * @param {string[]} options 
 */
async function queryCache(type,select,filterBy,options){
    if (!(type in CACHE)){
        CACHE[type] = {};
    }
    let tCache = CAHCE[type];
    let toFetch = options.filter(x=>!(x in tCache))
    if(toFetch.length > 0){
        Object.assign(tCache,await query(type,select,filterBy,options))
    }
    let r = {};
    for(let o in options){
        r[o] = tCache[o];
    }
    return r;
}

const getOrders =  (orders) => queryCache("SalesOrder","SalesOrderId","OrderNumber",orders);
const getCases =  (cases) => queryCache("CaseNumber","CaseNumberId","TicketNumber",cases);
const getUser =  (username) => queryCache("SystemUser","SystemUserId","DomainName",[username]);

async function uploadAll(rows){

    let cases = new Set();
    let orders = new Set();

    for(i in rows){
        if (i[6]) cases.add(i[6])
        if (i[7]) orders.add(i[7])
    }

    let [orderMap,caseMap] = await Promise.all([getOrders(orders),getCases(cases)]);

    

}