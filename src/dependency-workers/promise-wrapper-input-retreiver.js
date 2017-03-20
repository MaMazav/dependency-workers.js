'use strict';

function PromiseWrapperInputRetreiverClosure(WrapperInputRetreiverBase) {
    var asyncProxyScriptBlob = self['asyncProxyScriptBlob'];
    
    function PromiseWrapperInputRetreiver(promiseInputRetreiver) {
        WrapperInputRetreiverBase.call(this, promiseInputRetreiver);

        var that = this;
        that._promiseInputRetreiver = promiseInputRetreiver;
        
        if (!promiseInputRetreiver['getPromiseTaskProperties']) {
            throw 'AsyncProxy.DependencyWorkers: No ' +
                'promiseInputRetreiver.getPromiseTaskProperties() method';
        }
        if (!promiseInputRetreiver['preWorkerProcess']) {
            throw 'AsyncProxy.DependencyWorkers: No ' +
                'promiseInputRetreiver.preWorkerProcess() method';
        }
    }
    
    PromiseWrapperInputRetreiver.prototype = Object.create(WrapperInputRetreiverBase.prototype);

    PromiseWrapperInputRetreiver.prototype.createTaskContext = function(
            taskKey, callbacks) {
                
        var taskProperties = this._promiseInputRetreiver['getPromiseTaskProperties'](
            taskKey);
            
        return new PromiseTask(
            taskKey, taskProperties, this._promiseInputRetreiver, callbacks);
    };
    
    asyncProxyScriptBlob.addMember(
        PromiseWrapperInputRetreiverClosure, 'PromiseWrapperInputRetreiver', null, 'WrapperInputRetreiverBase');
    
    return PromiseWrapperInputRetreiver;
}

var PromiseWrapperInputRetreiver = PromiseWrapperInputRetreiverClosure(WrapperInputRetreiverBase);