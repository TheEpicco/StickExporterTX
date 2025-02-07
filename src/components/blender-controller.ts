import { blenderPath, blenderScriptPath, dataPath, templatePath } from "./paths";
import {spawn} from "child_process";
import logger from "./logger";
import { setBlenderLoading, setBlenderStatus } from "./ui/menu";
import { setLogNumber, setRenderDisplayProgress, setStatus } from "./ui/renderingSide";
import {imageLoading, imageLoaded} from "./ui/settingsSide";
import { getLogList, getLogSize, settingList } from "./settings";
import isValid from "is-valid-path";
import { sideSetRendering, setProgress } from "../renderer";
import { ipcRenderer } from "electron";

const blenderStartString = [
    templatePath,
    "--background",
    "--python",
    blenderScriptPath,
    "--",
    dataPath.replaceAll("\\", "/")
]

let blenderConsole = spawn(blenderPath, blenderStartString).on('error', function(err) {
    logger.errorMSG("Could not start blender: " + err.toString());
});
let readyToAcceptCommand = false;
let renderingPicture = false;
let renderingVideo = false;
let waitingForRender = false;

let logPortionList:number[] = [];
let currentLogPortion = 0;

const estimatedRenderPortion = 0.97;
function setRenderProgress(log:number, init:boolean, frameCount:number, frame:number) {
    let progress = 0;
    if(init) {
        progress = logPortionList[log-1] * (frame / frameCount * (1 - estimatedRenderPortion)) + currentLogPortion;
    } else {
        progress = logPortionList[log-1] * (frame / frameCount * estimatedRenderPortion + (1 - estimatedRenderPortion)) + currentLogPortion;
    }
    setProgress(progress);
    setRenderDisplayProgress(parseFloat((progress*100).toFixed(2)));
}

function startBlender() {
    let frames = "0";
    let lastFrame = "0";
    let log = "0";
    
    blenderConsole.stdout.on('data', function(data) {
        const dataStr = data.toString();
        
        logger.info("Blender: " + dataStr);
        
        if (dataStr.includes("Blender started successfully")) {
            renderingPicture = false;
            renderingVideo = false;
            setBlenderStatus("Started");
        }
        if (dataStr.includes("Blender quit")) {
            if(renderingPicture) {
                logger.errorMSG("Rendering preview Failed!");
            } else if(renderingVideo) {
                logger.errorMSG("Rendering video Failed!");
            }
            
            readyToAcceptCommand = false;
            renderingPicture = false;
            renderingVideo = false;
            setBlenderStatus("Restarting");
            setBlenderLoading(true);
            setProgress();
            restartBlender();
        }
        
        if(dataStr.includes("Frames:")) {
            frames = dataStr.split(":")[1];
            renderingVideo = true;
            readyToAcceptCommand = false;
            setRenderProgress(parseInt(log), true, 0, 0);
        }
        if(dataStr.includes("Fra:") && renderingVideo) {
            lastFrame = dataStr.split(":")[1].split(" ")[0];
            setStatus("Rendering Frame " + lastFrame + "/" + frames);
            setRenderProgress(parseInt(log), false, parseInt(frames), parseInt(lastFrame));
        }
        if(dataStr.includes("Finished") && renderingVideo) {
            sideSetRendering(false);
            if(lastFrame == frames) {
                setStatus("Finished Render Successfully!");
            } else {
                logger.errorMSG("Render Failed!");
            }
        }
        if(dataStr.includes("Init:") && renderingVideo) {
            setStatus("Initialize Frame " + dataStr.split(":")[1] + "/" + frames);
            setRenderProgress(parseInt(log), true, parseInt(frames), parseInt(dataStr.split(":")[1]));
        }
        if(dataStr.includes("Lognr:") && renderingVideo) {
            log = dataStr.split(":")[1];
            if(log !== "1") {
                currentLogPortion += logPortionList[parseInt(log)-2];
            }
            setLogNumber(log);
        }
        
        if(dataStr.includes("Waiting for command")) {
            sideSetRendering(false);
            setProgress();
            
            if(renderingPicture) {
                imageLoaded();
            }
            
            if(!waitingForRender) {
                readyToAcceptCommand = true;
                renderingPicture = false;
                renderingVideo = false;
                setBlenderStatus("Ready");
                setBlenderLoading(false);
            } else {
                waitingForRender = false;
                renderingPicture = true;
                blenderConsole.stdin.write("getRender\n");
                setBlenderStatus("Rendering");
                setBlenderLoading(true);
                imageLoading();
            }
        }
    });
    
    blenderConsole.stderr.on('data', function(data:string) {
        logger.errorMSG("Blender: " + data);
    });
}

function restartBlender() {
    sideSetRendering(false);
    blenderConsole.kill();
    blenderConsole = spawn(blenderPath, blenderStartString);
    startBlender();
}

enum blenderCmd {
    getRender,
    startRendering,
    stopRendering,
}

function blender(command:blenderCmd) {
    if(command === blenderCmd.getRender) {
        if(readyToAcceptCommand) {
            readyToAcceptCommand = false;
            renderingPicture = true;
            imageLoading();
            setBlenderStatus("Rendering");
            setBlenderLoading(true);
            blenderConsole.stdin.write("getRender\n");
        } else {
            waitingForRender = true;
        }
    } else if(command === blenderCmd.startRendering) {
        if(readyToAcceptCommand) {
            if(settingList.log == "") {
                logger.warningMSG("No log selected!");
            } else if(!isValid(settingList.log)) {
                logger.warningMSG("Output path is invalid!");
            } else {
                currentLogPortion = 0;
                
                const logSizeList:number[] = [];
                getLogList().forEach(function (value, index) {
                    logSizeList.push(getLogSize(index));
                });
                
                let fullLogSize = 0;
                for(let i = 0; i < logSizeList.length; i++) {
                    fullLogSize += logSizeList[i];
                }
                
                logPortionList = [];
                logSizeList.forEach(function (value) {
                    logPortionList.push(value / fullLogSize);
                });
                
                readyToAcceptCommand = false;
                renderingVideo = true;
                sideSetRendering(true);
                setBlenderStatus("Rendering");
                setBlenderLoading(true);
                blenderConsole.stdin.write("startRendering\n");
            }
        }
    } else if(command === blenderCmd.stopRendering) {
        readyToAcceptCommand = false;
        renderingPicture = false;
        renderingVideo = false;
        restartBlender();
    }
}

ipcRenderer.on("isRenderActiveClose", () => {
    if(renderingPicture || renderingVideo) {
        ipcRenderer.send("renderActiveClose");
    } else {
        ipcRenderer.send("renderInactiveClose");
    }
});

export {
    blender,
    blenderCmd,
    startBlender,
    renderingPicture
}