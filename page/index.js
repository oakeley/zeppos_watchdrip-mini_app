import {json2str, str2json} from "../shared/data";
import {DebugText} from "../shared/debug";
import {getGlobal} from "../shared/global";
import {gettext as getText} from "i18n";
import {
    Colors,
    Commands,
    DATA_STALE_TIME_MS,
    DATA_TIMER_UPDATE_INTERVAL_MS,
    DATA_UPDATE_INTERVAL_MS,
    PROGRESS_ANGLE_INC,
    PROGRESS_UPDATE_INTERVAL_MS,
    XDRIP_UPDATE_INTERVAL_MS,
} from "../utils/config/constants";
import {
    WATCHDRIP_ALARM_SETTINGS_DEFAULTS, WF_DIR,
    WF_INFO_FILE,
} from "../utils/config/global-constants";
import {
    BG_DELTA_TEXT,
    BG_STALE_RECT,
    BG_TIME_TEXT,
    BG_TREND_IMAGE,
    BG_VALUE_TEXT,
    COMMON_BUTTON_ADD_TREATMENT,
    COMMON_BUTTON_SETTINGS,
    CONFIG_PAGE_SCROLL,
    DEVICE_TYPE,
    IMG_LOADING_PROGRESS,
    MESSAGE_TEXT,
    RADIO_OFF,
    RADIO_ON,
    TITLE_TEXT,
    VERSION_TEXT,
} from "../utils/config/styles";

import * as fs from "./../shared/fs";
import {WatchdripData} from "../utils/watchdrip/watchdrip-data";
import {getDataTypeConfig, img} from "../utils/helper";
import {gotoSubpage} from "../shared/navigate";
import {WatchdripConfig} from "../utils/watchdrip/config";
import {Path} from "../utils/path";

const logger = DeviceRuntimeCore.HmLogger.getLogger("watchdrip_app");

const {messageBuilder} = getApp()._options.globalData;
const {appId} = hmApp.packageInfo();

/*
typeof DebugText
*/
var debug = null;
/*
typeof Watchdrip
*/
var watchdrip = null;

const GoBackType = {NONE: 'none', GO_BACK: 'go_back', HIDE_PAGE: 'hide_page', HIDE: 'hide'};
const PagesType = {
    MAIN: 'main',
    UPDATE: 'update',
    UPDATE_LOCAL: 'update_local',
    HIDE: 'hide',
    CONFIG: 'config',
    ADD_TREATMENT: 'add_treatment'
};
const FetchMode = {DISPLAY: 'display', HIDDEN: 'hidden'};

class Watchdrip {
    constructor() {

        this.createWatchdripDir();
        this.timeSensor = hmSensor.createSensor(hmSensor.id.TIME);
        this.vibrate = hmSensor.createSensor(hmSensor.id.VIBRATE);
        this.globalNS = getGlobal();
        this.goBackType = GoBackType.NONE;
        this.intervalWatchdog = null;
        this.system_alarm_id = null;
        this.lastInfoUpdate = 0;
        this.lastUpdateAttempt = null;
        this.lastUpdateSucessful = false;
        this.updatingData = false;
        this.intervalTimer = null;
        this.updateIntervals = DATA_UPDATE_INTERVAL_MS;
        this.fetchMode = FetchMode.DISPLAY;
        this.conf = new WatchdripConfig();
        debug.setEnabled(this.conf.settings.showLog);

        this.infoFile = new Path("full", WF_INFO_FILE);
    }

    start(data) {
        debug.log("start");
        debug.log(data);
        let pageTitle = '';
        this.goBackType = GoBackType.NONE;
        switch (data.page) {
            case PagesType.MAIN:
                let pkg = hmApp.packageInfo();
                pageTitle = pkg.name
                this.main_page();
                break;
            case PagesType.UPDATE:
                this.goBackType = GoBackType.HIDE;
                this.conf.alarmSettings = {...this.conf.alarmSettings, ...data.params};
                this.fetch_page();
                break;
            case PagesType.UPDATE_LOCAL:
                this.goBackType = GoBackType.HIDE;
                this.fetch_page_local_display(); // **CHANGED: Use new method**
                break;
            case PagesType.HIDE:
                this.hide_page();
                break;
            case PagesType.CONFIG:
                pageTitle = getText("settings");
                this.config_page();
                break;
            case PagesType.ADD_TREATMENT:
                pageTitle = getText("add_treatment");
                this.add_treatment_page()
                break;
        }

        if (pageTitle) {
            if (DEVICE_TYPE === "round") {
                this.titleTextWidget = hmUI.createWidget(hmUI.widget.TEXT, {...TITLE_TEXT, text: pageTitle})
            } else {
                hmUI.updateStatusBarTitle(pageTitle);
            }
        }
    }


    main_page() {
        hmSetting.setBrightScreen(60);
        hmApp.setScreenKeep(true);
        this.watchdripData = new WatchdripData(this.timeSensor);
        let pkg = hmApp.packageInfo();
        this.versionTextWidget = hmUI.createWidget(hmUI.widget.TEXT, {...VERSION_TEXT, text: "v" + pkg.version});
        this.messageTextWidget = hmUI.createWidget(hmUI.widget.TEXT, {...MESSAGE_TEXT, text: ""});
        this.bgValTextWidget = hmUI.createWidget(hmUI.widget.TEXT, BG_VALUE_TEXT);
        this.bgValTimeTextWidget = hmUI.createWidget(hmUI.widget.TEXT, BG_TIME_TEXT);
        this.bgDeltaTextWidget = hmUI.createWidget(hmUI.widget.TEXT, BG_DELTA_TEXT);
        this.bgTrendImageWidget = hmUI.createWidget(hmUI.widget.IMG, BG_TREND_IMAGE);
        this.bgStaleLine = hmUI.createWidget(hmUI.widget.FILL_RECT, BG_STALE_RECT);
        this.bgStaleLine.setProperty(hmUI.prop.VISIBLE, false);

        //for display tests
        // this.setMessageVisibility(false);
        // this.setBgElementsVisibility(true);
        // this.updateWidgets();
        // return;

        if (this.conf.settings.disableUpdates) {
            this.showMessage(getText("data_upd_disabled"));
        } else {
            if (this.readInfo()) {
                this.updateWidgets();
            }
            this.fetchInfo();
            this.startDataUpdates();
        }

        /*hmUI.createWidget(hmUI.widget.BUTTON, {
            ...COMMON_BUTTON_FETCH,
            click_func: (button_widget) => {
                this.fetchInfo();
            },
        });*/

        hmUI.createWidget(hmUI.widget.BUTTON, {
            ...COMMON_BUTTON_SETTINGS,
            click_func: (button_widget) => {
                gotoSubpage(PagesType.CONFIG);
            },
        });

        hmUI.createWidget(hmUI.widget.BUTTON, {
            ...COMMON_BUTTON_ADD_TREATMENT,
            click_func: (button_widget) => {
                gotoSubpage(PagesType.ADD_TREATMENT);
            },
        });
    }

    getConfigData() {
        let dataList = [];

        Object.entries(this.conf.settings).forEach(entry => {
            const [key, value] = entry;
            let stateImg = RADIO_OFF
            if (value) {
                stateImg = RADIO_ON
            }
            dataList.push({
                key: key,
                name: getText(key),
                state_src: img('icons/' + stateImg)
            });
        });
        this.configDataList = dataList;

        let dataTypeConfig = [
            getDataTypeConfig(1, 0, dataList.length)
        ]
        return {
            data_array: dataList,
            data_count: dataList.length,
            data_type_config: dataTypeConfig,
            data_type_config_count: dataTypeConfig.length
        }
    }

    add_treatment_page() {
        //not implemented
    }

    config_page() {
        hmUI.setLayerScrolling(false);

        this.configScrollList = hmUI.createWidget(hmUI.widget.SCROLL_LIST,
            {
                ...CONFIG_PAGE_SCROLL,
                item_click_func: (list, index) => {
                    debug.log(index);
                    const key = this.configDataList[index].key
                    let val = this.conf.settings[key]
                    this.conf.settings[key] = !val;
                    this.conf.settingsTime = this.timeSensor.utc; // upd settings time
                    //update list
                    this.configScrollList.setProperty(hmUI.prop.UPDATE_DATA, {
                        ...this.getConfigData(),
                        //Refresh the data and stay on the current page. If it is not set or set to 0, it will return to the top of the list.
                        on_page: 1
                    })
                },
                ...this.getConfigData()
            });
    }

    startDataUpdates() {
        if (this.intervalTimer != null) return; //already started
        debug.log("startDataUpdates");
        this.intervalTimer = this.globalNS.setInterval(() => {
            this.checkUpdates();
        }, DATA_TIMER_UPDATE_INTERVAL_MS);
    }

    stopDataUpdates() {
        if (this.intervalTimer !== null) {
            //debug.log("stopDataUpdates");
            this.globalNS.clearInterval(this.intervalTimer);
            this.intervalTimer = null;
        }
    }

    isTimeout(time, timeout_ms) {
        if (!time) {
            return false;
        }
        return this.timeSensor.utc - time > timeout_ms;
    }

    handleRareCases() {
        let fetch = false;
        if (this.lastUpdateAttempt == null) {
            debug.log("initial fetch");
            fetch = true;
        } else if (this.isTimeout(this.lastUpdateAttempt, DATA_STALE_TIME_MS)) {
            debug.log("the side app not responding, force update again");
            fetch = true;
        }
        if (fetch) {
            this.fetchInfo();
        }
    }

    checkUpdates() {
        //debug.log("checkUpdates");
        this.updateTimesWidget();
        if (this.updatingData) {
            //debug.log("updatingData, return");
            return;
        }
        let lastInfoUpdate = this.readLastUpdate();
        if (!lastInfoUpdate) {
            this.handleRareCases();
        } else {
            if (this.lastUpdateSucessful) {
                if (this.lastInfoUpdate !== lastInfoUpdate) {
                    //update widgets because the data was modified outside the current scope
                    debug.log("update from remote");
                    this.readInfo();
                    this.lastInfoUpdate = lastInfoUpdate;
                    this.updateWidgets();
                    return;
                }
                if (this.isTimeout(lastInfoUpdate, this.updateIntervals)) {
                    debug.log("reached updateIntervals");
                    this.fetchInfo();
                    return;
                }
                const bgTimeOlder = this.isTimeout(this.watchdripData.getBg().time, XDRIP_UPDATE_INTERVAL_MS);
                const statusNowOlder = this.isTimeout(this.watchdripData.getStatus().now, XDRIP_UPDATE_INTERVAL_MS);
                if (bgTimeOlder || statusNowOlder) {
                    if (!this.isTimeout(this.lastUpdateAttempt, DATA_STALE_TIME_MS)) {
                        debug.log("wait DATA_STALE_TIME");
                        return;
                    }
                    debug.log("data older than sensor update interval");
                    this.fetchInfo();
                    return;
                }
                //data not modified from outside scope so nothing to do
                debug.log("data not modified");
            } else {
                this.handleRareCases();
            }
        }
    }

    fetch_page() {
        debug.log("fetch_page");
        hmUI.setStatusBarVisible(false);
        this.prepareNextAlarm();
        if (this.conf.settings.disableUpdates || !this.conf.settings.useAppFetch) {
            this.handleGoBack();
            return;
        }
        hmSetting.setBrightScreen(999);
        this.progressWidget = hmUI.createWidget(hmUI.widget.IMG, IMG_LOADING_PROGRESS);
        this.progressAngle = 0;
        this.stopLoader();
        this.fetchMode = FetchMode.HIDDEN;
        this.fetchInfo(this.conf.alarmSettings.fetchParams);
    }

    fetch_page_local() {
        debug.log("fetch_page");
        hmUI.setStatusBarVisible(false);
        this.progressWidget = hmUI.createWidget(hmUI.widget.IMG, IMG_LOADING_PROGRESS);
        this.progressAngle = 0;
        this.stopLoader();
        this.fetchMode = FetchMode.HIDDEN;
        this.fetchInfo(this.conf.alarmSettings.fetchParams);
    }

    // **NEW METHOD: Display glucose data during background fetch**
    fetch_page_local_display() {
        debug.log("fetch_page_local_display - showing glucose data");
        hmUI.setStatusBarVisible(false);
        hmSetting.setBrightScreen(60); // Set moderate brightness
        
        // Get screen info for responsive progress indicator
        const deviceInfo = hmSetting.getDeviceInfo();
        const screenWidth = deviceInfo.width;
        const screenHeight = deviceInfo.height;
        
        // Initialize glucose data display
        this.watchdripData = new WatchdripData(this.timeSensor);
        
        // Create glucose display widgets with dynamic sizing
        this.createGlucoseDisplayWidgets();
        
        // Read and display current glucose data immediately
        if (this.readInfo()) {
            this.updateWatchfaceStyleWidgets();
            this.setBgElementsVisibility(true);
            debug.log("Displaying current glucose data during update");
        } else {
            // Show "Loading..." message if no data available
            this.messageTextWidget = hmUI.createWidget(hmUI.widget.TEXT, {
                x: Math.floor(screenWidth * 0.05),
                y: Math.floor(screenHeight * 0.4),
                w: Math.floor(screenWidth * 0.9),
                h: Math.floor(screenHeight * 0.2),
                text: "Loading glucose data...",
                text_size: Math.floor(screenWidth * 0.07),
                color: Colors.white,
                align_h: hmUI.align.CENTER_H,
                align_v: hmUI.align.CENTER_V,
                text_style: hmUI.text_style.NONE
            });
            this.setMessageVisibility(true);
        }
        
        // Create small progress indicator in corner (responsive size and position)
        const progressSize = Math.floor(screenWidth * 0.06);
        this.progressWidget = hmUI.createWidget(hmUI.widget.IMG, {
            ...IMG_LOADING_PROGRESS,
            x: screenWidth - progressSize - Math.floor(screenWidth * 0.05), // 5% margin from edge
            y: Math.floor(screenHeight * 0.05), // 5% from top
            w: progressSize,
            h: progressSize
        });
        
        this.progressAngle = 0;
        this.startLoader();
        this.fetchMode = FetchMode.HIDDEN;
        
        // Start background fetch after brief delay to ensure display is shown
        this.globalNS.setTimeout(() => {
            this.fetchInfoSilent(this.conf.alarmSettings.fetchParams);
        }, 200);
    }

    // **NEW METHOD: Create glucose display widgets**
    createGlucoseDisplayWidgets() {
        // Get screen dimensions and determine if round
        const deviceInfo = hmSetting.getDeviceInfo();
        const screenWidth = deviceInfo.width;
        const screenHeight = deviceInfo.height;
        const isRound = (screenWidth === screenHeight); // Round screens are typically square
        
        debug.log(`Screen: ${screenWidth}x${screenHeight}, Round: ${isRound}`);
        
        // Calculate responsive dimensions using ratios
        const centerX = Math.floor(screenWidth / 2);
        const usableWidth = Math.floor(screenWidth * 0.9); // 90% of screen width
        const leftMargin = Math.floor((screenWidth - usableWidth) / 2);
        
        // Font sizes as ratios of screen width
        const timeFontSize = Math.floor(screenWidth * 0.15); // ~15% of screen width
        const secondsFontSize = Math.floor(screenWidth * 0.08); // ~8% of screen width
        const deltaFontSize = Math.floor(screenWidth * 0.075); // ~7.5% of screen width
        const glucoseFontSize = Math.floor(screenWidth * 0.23); // ~23% of screen width
        
        // Vertical positioning as ratios of screen height
        const timeY = Math.floor(screenHeight * 0.12); // 12% from top
        const deltaY = Math.floor(screenHeight * 0.32); // 32% from top
        const glucoseY = Math.floor(screenHeight * 0.45); // 45% from top
        const arrowY = Math.floor(screenHeight * 0.75); // 75% from top
        const staleY = Math.floor(screenHeight * 0.92); // 92% from top
        
        // Arrow size proportional to screen
        const arrowSize = Math.floor(screenWidth * 0.14);
        
        // Time display - larger hours:minutes, white text, centered
        this.bgTimeTextWidget = hmUI.createWidget(hmUI.widget.TEXT, {
            x: leftMargin,
            y: timeY,
            w: usableWidth,
            h: Math.floor(screenHeight * 0.15),
            color: Colors.white,
            text_size: timeFontSize,
            align_h: hmUI.align.CENTER_H,
            align_v: hmUI.align.CENTER_V,
            text_style: hmUI.text_style.NONE,
            text: "--:--" // Default placeholder
        });

        // Seconds display - smaller, positioned to the right of center
        const secondsX = isRound ? 
            centerX + Math.floor(timeFontSize * 1.8) : // Round: offset from center
            Math.floor(screenWidth * 0.75); // Rectangular: 75% across
        
        this.bgSecondsTextWidget = hmUI.createWidget(hmUI.widget.TEXT, {
            x: secondsX,
            y: timeY + Math.floor(timeFontSize * 0.25),
            w: Math.floor(screenWidth * 0.2),
            h: Math.floor(screenHeight * 0.1),
            color: Colors.white,
            text_size: secondsFontSize,
            align_h: hmUI.align.LEFT,
            align_v: hmUI.align.CENTER_V,
            text_style: hmUI.text_style.NONE,
            text: "--" // Default placeholder
        });

        // Delta and time ago - white text, centered
        this.bgDeltaTextWidget = hmUI.createWidget(hmUI.widget.TEXT, {
            x: leftMargin,
            y: deltaY,
            w: usableWidth,
            h: Math.floor(screenHeight * 0.1),
            color: Colors.white,
            text_size: deltaFontSize,
            align_h: hmUI.align.CENTER_H,
            align_v: hmUI.align.CENTER_V,
            text_style: hmUI.text_style.NONE,
            text: "-- --" // Default placeholder
        });

        // Main glucose value - large, centered
        this.bgValTextWidget = hmUI.createWidget(hmUI.widget.TEXT, {
            x: leftMargin,
            y: glucoseY,
            w: usableWidth,
            h: Math.floor(screenHeight * 0.25),
            color: Colors.white,
            text_size: glucoseFontSize,
            align_h: hmUI.align.CENTER_H,
            align_v: hmUI.align.CENTER_V,
            text_style: hmUI.text_style.NONE,
            text: "--" // Default placeholder
        });

        // Trend arrow - positioned below glucose value, centered
        this.bgTrendImageWidget = hmUI.createWidget(hmUI.widget.IMG, {
            x: centerX - Math.floor(arrowSize / 2), // Centered horizontally
            y: arrowY,
            w: arrowSize,
            h: arrowSize,
            src: 'watchdrip/arrows/None.png'
        });

        // Stale indicator - responsive width and position
        const staleHeight = Math.floor(screenHeight * 0.008); // Very thin line
        this.bgStaleLine = hmUI.createWidget(hmUI.widget.FILL_RECT, {
            x: leftMargin,
            y: staleY,
            w: usableWidth,
            h: staleHeight,
            color: Colors.bgHigh,
            visible: false
        });
        
        debug.log(`Layout created for ${screenWidth}x${screenHeight} (${isRound ? 'round' : 'rectangular'})`);
    }

    // **NEW METHOD: Silent background fetch**
    fetchInfoSilent(params = '') {
        debug.log("fetchInfoSilent - fetching new data");
        
        this.resetLastUpdate();

        if (messageBuilder.connectStatus() === false) {
            debug.log("No BT Connection in silent mode");
            this.stopLoader();
            this.handleGoBack();
            return;
        }

        if (params === "") {
            params = WATCHDRIP_ALARM_SETTINGS_DEFAULTS.fetchParams;
        }

        this.updatingData = true;
        
        // Set timeout to auto-exit if fetch takes too long
        this.silentTimeout = this.globalNS.setTimeout(() => {
            debug.log("Silent fetch timeout");
            this.stopLoader();
            this.handleGoBack();
        }, 4000);
        
        messageBuilder
            .request({
                method: Commands.getInfo,
                params: params,
            }, {timeout: 4000})
            .then((data) => {
                debug.log("received silent data");
                let {result: info = {}} = data;
                try {
                    if (info.error) {
                        debug.log("Silent fetch error");
                        return;
                    }
                    
                    // Save the new data
                    this.lastInfoUpdate = this.saveInfo(info);
                    
                    // Update display with new data
                    let dataInfo = str2json(info);
                    this.watchdripData.setData(dataInfo);
                    this.watchdripData.updateTimeDiff();
                    
                    // Refresh the glucose display
                    this.updateWatchfaceStyleWidgets();
                    
                    dataInfo = null;
                    info = null;
                    
                    debug.log("Updated glucose display with new data");
                } catch (e) {
                    debug.log("silent fetch error:" + e);
                }
            })
            .catch((error) => {
                debug.log("silent fetch error:" + error);
            })
            .finally(() => {
                this.updatingData = false;
                this.stopLoader();
                
                if (this.silentTimeout) {
                    this.globalNS.clearTimeout(this.silentTimeout);
                    this.silentTimeout = null;
                }
                
                // Show updated data briefly before returning to watchface
                this.globalNS.setTimeout(() => {
                    this.handleGoBack();
                }, 1000); // Show for 1 second before returning
            });
    }

    // **UPDATED METHOD: Update glucose widgets in watchface style**
    updateWatchfaceStyleWidgets() {
        if (!this.watchdripData) {
            debug.log("No watchdripData available");
            return;
        }

        const bgObj = this.watchdripData.getBg();
        
        if (!bgObj || !bgObj.isHasData()) {
            debug.log("No glucose data available");
            // Set placeholder values when no data
            if (this.bgValTextWidget) {
                this.bgValTextWidget.setProperty(hmUI.prop.MORE, {
                    text: "--",
                    color: Colors.white
                });
            }
            if (this.bgDeltaTextWidget) {
                this.bgDeltaTextWidget.setProperty(hmUI.prop.MORE, {
                    text: "-- --"
                });
            }
            return;
        }

        // Determine glucose value color based on high/low status
        let bgValColor = Colors.white;
        if (bgObj.isHigh) {
            bgValColor = Colors.bgHigh;
        } else if (bgObj.isLow) {
            bgValColor = Colors.bgLow;
        }

        // Update main glucose value with actual data
        if (this.bgValTextWidget) {
            this.bgValTextWidget.setProperty(hmUI.prop.MORE, {
                text: bgObj.getBGVal() || "--",
                color: bgValColor,
            });
        }

        // Update time display (current time) - hours:minutes only
        const now = new Date();
        const timeStr = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        
        if (this.bgTimeTextWidget) {
            this.bgTimeTextWidget.setProperty(hmUI.prop.MORE, {
                text: timeStr
            });
        }

        // Update seconds separately
        if (this.bgSecondsTextWidget) {
            this.bgSecondsTextWidget.setProperty(hmUI.prop.MORE, {
                text: seconds
            });
        }

        // Update delta with time ago - format like "0.0 now" or "+0.2 5 mins"
        const timeAgo = this.watchdripData.getTimeAgo(bgObj.time);
        const delta = bgObj.delta || "0.0";
        let deltaText;
        
        if (!timeAgo || timeAgo === "" || timeAgo === "0 mins") {
            deltaText = delta + " now";
        } else {
            deltaText = delta + " " + timeAgo;
        }
        
        if (this.bgDeltaTextWidget) {
            this.bgDeltaTextWidget.setProperty(hmUI.prop.MORE, {
                text: deltaText
            });
        }

        // Update trend arrow with actual arrow resource
        if (this.bgTrendImageWidget && bgObj.getArrowResource) {
            this.bgTrendImageWidget.setProperty(hmUI.prop.SRC, bgObj.getArrowResource());
        }
        
        // Update stale indicator based on actual data freshness
        if (this.bgStaleLine) {
            const isStale = this.watchdripData.isBgStale();
            this.bgStaleLine.setProperty(hmUI.prop.VISIBLE, isStale);
        }
        
        debug.log(`Updated glucose display: ${bgObj.getBGVal()} ${deltaText} (${bgObj.isHigh ? 'HIGH' : bgObj.isLow ? 'LOW' : 'NORMAL'})`);
    }

    hide_page() {
        hmApp.gotoHome();
    }

    fetchInfo(params = '') {
        debug.log("fetchInfo");
        let isDisplay = true;
        if (this.fetchMode === FetchMode.HIDDEN) {
            isDisplay = false;
        }

        this.resetLastUpdate();

        if (messageBuilder.connectStatus() === false) {
            debug.log("No BT Connection");
            if (isDisplay) {
                this.showMessage(getText("status_no_bt"));
            } else {
                this.handleGoBack();
            }
            return;
        }

        if (params === "") {
            params = WATCHDRIP_ALARM_SETTINGS_DEFAULTS.fetchParams;
        }

        if (isDisplay) {
            this.showMessage(getText("connecting"));
        } else {
            this.startLoader();
            if (this.intervalWatchdog === null) {
                this.intervalWatchdog = this.globalNS.setTimeout(() => {
                    this.stopLoader();
                    this.handleGoBack();
                }, 5000);
            }
        }
        this.updatingData = true;
        messageBuilder
            .request({
                method: Commands.getInfo,
                params: params,
            }, {timeout: 5000})
            .then((data) => {
                debug.log("received data");
                let {result: info = {}} = data;
                //debug.log(info);
                try {
                    if (info.error) {
                        debug.log("Error");
                        debug.log(info);
                        return;
                    }
                    let dataInfo = str2json(info);
                    this.lastInfoUpdate = this.saveInfo(info);
                    info = null;
                    if (isDisplay) {
                        this.watchdripData.setData(dataInfo);
                        this.watchdripData.updateTimeDiff();
                        dataInfo = null;

                        this.updateWidgets();
                    }
                } catch (e) {
                    debug.log("error:" + e);
                }
            })
            .catch((error) => {
                debug.log("fetch error:" + error);
            })
            .finally(() => {
                this.updatingData = false;
                if (isDisplay && !this.lastUpdateSucessful) {
                    this.showMessage(getText("status_start_watchdrip"));
                }
                if (!isDisplay) {
                    this.stopLoader();
                    this.handleGoBack();
                }
            });
    }

    startLoader() {
        this.progressWidget.setProperty(hmUI.prop.VISIBLE, true);
        this.progressWidget.setProperty(hmUI.prop.MORE, {angle: this.progressAngle});
        this.progressTimer = this.globalNS.setInterval(() => {
            this.updateLoader();
        }, PROGRESS_UPDATE_INTERVAL_MS);
    }

    updateLoader() {
        this.progressAngle = this.progressAngle + PROGRESS_ANGLE_INC;
        if (this.progressAngle >= 360) this.progressAngle = 0;
        this.progressWidget.setProperty(hmUI.prop.MORE, {angle: this.progressAngle});
    }

    stopLoader() {
        if (this.progressTimer !== null) {
            this.globalNS.clearInterval(this.progressTimer);
            this.progressTimer = null;
        }
        if (this.progressWidget) {
            this.progressWidget.setProperty(hmUI.prop.VISIBLE, false);
        }
    }

    updateWidgets() {
        debug.log('updateWidgets');
        this.setMessageVisibility(false);
        this.setBgElementsVisibility(true);
        this.updateValuesWidget()
        this.updateTimesWidget()
    }

    updateValuesWidget() {
        let bgValColor = Colors.white;
        let bgObj = this.watchdripData.getBg();
        if (bgObj.isHigh) {
            bgValColor = Colors.bgHigh;
        } else if (bgObj.isLow) {
            bgValColor = Colors.bgLow;
        }

        this.bgValTextWidget.setProperty(hmUI.prop.MORE, {
            text: bgObj.getBGVal(),
            color: bgValColor,
        });

        this.bgDeltaTextWidget.setProperty(hmUI.prop.MORE, {
            text: bgObj.delta + " " + this.watchdripData.getStatus().getUnitText()
        });

        //debug.log(bgObj.getArrowResource());
        this.bgTrendImageWidget.setProperty(hmUI.prop.SRC, bgObj.getArrowResource());
        this.bgStaleLine.setProperty(hmUI.prop.VISIBLE, this.watchdripData.isBgStale());
    }

    updateTimesWidget() {
        let bgObj = this.watchdripData.getBg();
        this.bgValTimeTextWidget.setProperty(hmUI.prop.MORE, {
            text: this.watchdripData.getTimeAgo(bgObj.time),
        });
    }

    showMessage(text) {
        this.setBgElementsVisibility(false);
        //use for autowrap
        //
        // let lay = hmUI.getTextLayout(text, {
        //     text_size: MESSAGE_TEXT_SIZE,
        //     text_width: MESSAGE_TEXT_WIDTH,
        //     wrapped: 1
        // });
        // debug.log(lay);
        this.messageTextWidget.setProperty(hmUI.prop.MORE, {text: text});
        this.setMessageVisibility(true);
    }

    setBgElementsVisibility(visibility) {
        if (this.bgValTextWidget) this.bgValTextWidget.setProperty(hmUI.prop.VISIBLE, visibility);
        if (this.bgValTimeTextWidget) this.bgValTimeTextWidget.setProperty(hmUI.prop.VISIBLE, visibility);
        if (this.bgSecondsTextWidget) this.bgSecondsTextWidget.setProperty(hmUI.prop.VISIBLE, visibility); // **NEW**
        if (this.bgTrendImageWidget) this.bgTrendImageWidget.setProperty(hmUI.prop.VISIBLE, visibility);
        if (this.bgStaleLine) this.bgStaleLine.setProperty(hmUI.prop.VISIBLE, visibility);
        if (this.bgDeltaTextWidget) this.bgDeltaTextWidget.setProperty(hmUI.prop.VISIBLE, visibility);
        if (this.bgTimeTextWidget) this.bgTimeTextWidget.setProperty(hmUI.prop.VISIBLE, visibility);
    }

    setMessageVisibility(visibility) {
        if (this.messageTextWidget) this.messageTextWidget.setProperty(hmUI.prop.VISIBLE, visibility);
    }

    readInfo() {
        let data = this.infoFile.fetchJSON();
        if (data) {
            debug.log("data was read");
            this.watchdripData.setData(data);
            this.watchdripData.timeDiff = 0;
            data = null;
            return true
        }
        return false;
    }

    readLastUpdate() {
        debug.log("readLastUpdate");
        this.conf.read();
        this.lastUpdateAttempt = this.conf.infoLastUpdAttempt;
        this.lastUpdateSucessful = this.conf.infoLastUpdSucess;

        return this.conf.infoLastUpd;
    }

    resetLastUpdate() {
        debug.log("resetLastUpdate");
        this.lastUpdateAttempt = this.timeSensor.utc;
        this.lastUpdateSucessful = false;
        this.conf.infoLastUpdAttempt = this.lastUpdateAttempt
        this.conf.infoLastUpdSucess = this.lastUpdateSucessful;
    }

    createWatchdripDir() {
        let osVersion;
        try { //create dir for old firmwares
            let systemInfo = hmSetting.getSystemInfo();
            osVersion = Number(systemInfo.osVersion)
        } catch (e) {
            osVersion = 1;
        }
        if (osVersion < 3) {
            let dir = new Path("full", WF_DIR);
            if (!dir.exists()) {
                dir.mkdir();
            }
        }
    }

    saveInfo(info) {
        debug.log("saveInfo");
        this.infoFile.overrideWithText(info);
        this.lastUpdateSucessful = true;
        let time = this.timeSensor.utc;
        this.conf.infoLastUpd = time
        this.conf.infoLastUpdSucess = this.lastUpdateSucessful;
        return time;
    }

    saveAlarmId(alarm_id) {
        debug.log("saveAlarmId");
        this.conf.alarm_id = alarm_id;
    }

    disableCurrentAlarm() {
        debug.log("disableCurrentAlarm");
        const alarm_id = this.conf.alarm_id; //read saved alarm to disable
        if (alarm_id && alarm_id !== -1) {
            debug.log("stop old app alarm");
            hmApp.alarmCancel(alarm_id);
            this.saveAlarmId('-1');
        }
    }

    prepareNextAlarm() {
        this.disableCurrentAlarm();
        if (this.conf.settings.disableUpdates || !this.conf.settings.useAppFetch) {
            if (this.system_alarm_id !== null) {
                hmApp.alarmCancel(this.system_alarm_id);
            }
            return;
        }
        debug.log("Next alarm in " + this.conf.alarmSettings.fetchInterval + "s");
        if (this.system_alarm_id == null) {
            this.system_alarm_id = hmApp.alarmNew({
                appid: appId,
                url: "page/index",
                param: PagesType.UPDATE_LOCAL,
                delay: this.conf.alarmSettings.fetchInterval,
            });
            this.saveAlarmId(this.system_alarm_id);
        }
    }

    handleGoBack() {
        switch (this.goBackType) {
            case GoBackType.NONE:
                break;
            case GoBackType.GO_BACK:
                hmApp.goBack();
                break;
            case GoBackType.HIDE:
                this.hide_page();
                break;
            case GoBackType.HIDE_PAGE:
                gotoSubpage(PagesType.HIDE);
                break;
        }
    }


    fetchImg() {
        const fileName = SERVER_IMAGE_URL;
        messageBuilder
            .request({
                method: Commands.getImg,
                params: fileName,
            })
            .then((data) => {
                logger.log("receive data");
                const {result = {}} = data;
                debug.log(`Received file size: ${result.length} bytes`);
                let filePath = fs.fullPath(fileName);
                debug.log(filePath);
                let file = fs.getSelfPath() + "/assets";
                const [fileNameArr, err] = hmFS.readdir(file);
                debug.log(file);
                debug.log(fileNameArr);

                const hex = Buffer.from(result, "base64");

                fs.writeRawFileSync(filePath, hex);
                var res = fs.statSync(filePath);
                debug.log(res);
                // Image view
                let view = hmUI.createWidget(hmUI.widget.IMG, {
                    x: px(0),
                    y: px(0),
                    src: fileName,
                });
            });
    }

    vibrateNow() {
        this.vibrate.stop();
        this.vibrate.scene = 24;
        this.vibrate.start();
    }

    onDestroy() {
        //this.disableCurrentAlarm(); //do not stop alarm on destroy
        this.conf.save();
        this.stopDataUpdates();
        this.vibrate.stop();
        hmSetting.setBrightScreenCancel();
    }
}

Page({
    onInit(p) {
        try {
            debug = new DebugText();
            debug.setLines(20);
            console.log("page onInit");
            let data = {page: PagesType.MAIN};
            try {
                if (!(!p || p === 'undefined')) {
                    data = JSON.parse(p);
                }
            } catch (e) {
                data = {page: p}
            }

            watchdrip = new Watchdrip()
            watchdrip.start(data);
        } catch (e) {
            debug.log('LifeCycle Error ' + e)
            e && e.stack && e.stack.split(/\n/).forEach((i) => debug.log('error stack:' + i))
        }
    },
    build() {
        logger.debug("page build invoked");
    },
    onDestroy() {
        logger.debug("page onDestroy invoked");
        watchdrip.onDestroy();
    },
});
