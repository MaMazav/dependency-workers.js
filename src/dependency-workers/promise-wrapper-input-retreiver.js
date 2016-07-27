'use strict';

function PromiseWrapperInputRetreiverClosure() {
    var asyncProxyScriptBlob = self['asyncProxyScriptBlob'];
    
    function PromiseWrapperInputRetreiver(promiseInputRetreiver) {
        if (!promiseInputRetreiver['getDependsOnTasks']) {
            throw 'AsyncProxy.DependencyWorkers: No ' +
                'promiseInputRetreiver.getDependsOnTasks() method';
        }
        if (!promiseInputRetreiver['preWorkerProcess']) {
            throw 'AsyncProxy.DependencyWorkers: No ' +
                'promiseInputRetreiver.preWorkerProcess() method';
        }
        if (!promiseInputRetreiver['getHashCode']) {
            throw 'AsyncProxy.DependencyWorkers: No ' +
                'promiseInputRetreiver.getHashCode() method';
        }
        if (!promiseInputRetreiver['isEqual']) {
            throw 'AsyncProxy.DependencyWorkers: No ' +
                'promiseInputRetreiver.isEqual() method';
        }

        var that = this;
        that._promiseInputRetreiver = promiseInputRetreiver;
    }
    
    PromiseWrapperInputRetreiver.prototype.createTaskContext = function(
            taskKey, callbacks) {
                
        var dependsOnTasks = this._promiseInputRetreiver['getDependsOnTasks'](
            taskKey);
            
        return new PromiseTask(
            taskKey, dependsOnTasks, this._promiseInputRetreiver, callbacks);
    };
    
    PromiseWrapperInputRetreiver.prototype.getHashCode = function(key) {
        return this._promiseInputRetreiver['getHashCode'](key);
    };
    
    PromiseWrapperInputRetreiver.prototype.isEqual = function(key1, key2) {
        return this._promiseInputRetreiver['isEqual'](key1, key2);
    };
    
    asyncProxyScriptBlob.addMember(
        PromiseWrapperInputRetreiverClosure, 'PromiseWrapperInputRetreiver');
    
    return PromiseWrapperInputRetreiver;
}

var PromiseWrapperInputRetreiver = PromiseWrapperInputRetreiverClosure();