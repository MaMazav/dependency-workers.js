'use strict';

var ScriptsToImportPool = (function ScriptsToImportPoolClosure() {
    function ScriptsToImportPool() {
        this._scriptsByName = {};
        this._scriptsArray = null;
    }
    
    ScriptsToImportPool.prototype.addScriptFromErrorWithStackTrace =
        function addScriptForWorkerImport(errorWithStackTrace) {
        
        var fileName = ScriptsToImportPool._getScriptName(errorWithStackTrace);
        
        if (!this._scriptsByName[fileName]) {
            this._scriptsByName[fileName] = true;
            this._scriptsArray = null;
        }
    };
    
    ScriptsToImportPool.prototype.getScriptsForWorkerImport =
        function getScriptsForWorkerImport() {
        
        if (this._scriptsArray === null) {
            this._scriptsArray = [];
            for (var fileName in this._scriptsByName) {
                this._scriptsArray.push(fileName);
            }
        }
        
        return this._scriptsArray;
    };
    
    ScriptsToImportPool._getScriptName = function getScriptName(errorWithStackTrace) {
        var callee = arguments.callee.name;
        var currentStackFrameRegex = new RegExp(callee + ' \\((.+?):\\d+:\\d+\\)');
        var source = currentStackFrameRegex.exec(errorWithStackTrace.stack.trim())
        if (source && source[1] !== "") {
            return source[1];
        }

        var lastStackFrameRegex = new RegExp(/.+\/(.*?):\d+(:\d+)*$/)
        source = lastStackFrameRegex.exec(errorWithStackTrace.stack.trim());
        if (source && source[1] !== "") {
            return source[1];
        }
        
        if (errorWithStackTrace.fileName != undefined) {
            return errorWithStackTrace.fileName;
        }
        
        throw 'ImageDecoderFramework.js: Could not get current script URL';
    };
        
    return ScriptsToImportPool;
})();