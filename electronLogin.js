const electron = require('electron');

function fork(url,neededCookies){
    console.log("Forking",url,neededCookies)

    const child_process = require('child_process');
    const arg = [url,...neededCookies].join(" ")
    const child = child_process.execFile(electron,[__filename,arg]);

    return new Promise(resolve=>{
        child.stdout.on("data",(chunk)=>{
            if (chunk.startsWith("COOKIES ")){
                let cookies = JSON.parse(chunk.substr(8));
                resolve(cookies);
            }
        });

        child.once("close",(n,s)=>resolve(null));
    });
}

function open(url,neededCookies){
    const { app, BrowserWindow, session } = electron;
    let _resolve;

    function createWindow(){
        let win = new BrowserWindow({
            width: 800,
            height: 600,
        });

        win.webContents.on("did-navigate",async (e,url,code,status)=>{
            const cookies = await session.defaultSession.cookies.get({url});
            const ourCookies = cookies.filter(x=>neededCookies.includes(x.name));
            if (ourCookies.length == neededCookies.length){
                _resolve(ourCookies);
                win.close();
            }
        })
        win.on("closed",()=>{
            win=null;
            _resolve(null);
        });
        win.loadURL(url);
    }
    return new Promise((resolve,reject)=>{
        _resolve=resolve;
        app.on('ready', ()=>{
            try {
                createWindow()
            } catch(e) {
                reject(e)
            }
        });
        app.on('error', reject);
    });
}



module.exports =
/**
 * Presents the given login portal to the end user, and waits will the specified cookies
 * have been set. Once they requested cookies have all been set the window closed and the
 * promise resolves with their values.
 * @param {string} url The url of the Login portal
 * @param {*} neededCookies 
 * @return {Promise<Electron.Cookie[]|null>}
 */
function(url,neededCookies){
    if (neededCookies === undefined){
        neededCookies = [];
    }

    return typeof electron === "string"?
        fork(url,neededCookies):
        open(url,neededCookies);
}

if (require.main === module) {
    let [a,b,url,...neededCookies] = process.argv;
    if (neededCookies.length == 0){
        [url,...neededCookies] = url.split(" ");
    }

    module.exports(url,neededCookies)
        .then(x=>console.log("COOKIES "+JSON.stringify(x)))
        .catch(e=>console.error(e))
}