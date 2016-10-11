'use strict';

function PromiseWrapperInputRetreiverClosure() {
    var asyncProxyScriptBlob = self['asyncProxyScriptBlob'];
    
    function PromiseWrapperInputRetreiver(promiseInputRetreiver) {
        WrapperInputRetreiverBase.call(this, promiseInputRetreiver);

        var that = this;
        that._promiseInputRetreiver = promiseInputRetreiver;
        
        if (!promiseInputRetreiver['getDependsOnTasks']) {
            throw 'AsyncProxy.DependencyWorkers: No ' +
                'promiseInputRetreiver.getDependsOnTasks() method';
        }
        if (!promiseInputRetreiver['preWorkerProcess']) {
            throw 'AsyncProxy.DependencyWorkers: No ' +
                'promiseInputRetreiver.preWorkerProcess() method';
        }
    }
    
    PromiseWrapperInputRetreiver.prototype = Object.create(WrapperInputRetreiverBase.prototype);

    PromiseWrapperInputRetreiver.prototype.createTaskContext = function(
            taskKey, callbacks) {
                
        var dependsOnTasks = this._promiseInputRetreiver['getDependsOnTasks'](
            taskKey);
            
        return new PromiseTask(
            taskKey, dependsOnTasks, this._promiseInputRetreiver, callbacks);
    };
    
    asyncProxyScriptBlob.addMember(
        PromiseWrapperInputRetreiverClosure, 'PromiseWrapperInputRetreiver');
    
    return PromiseWrapperInputRetreiver;
}

var PromiseWrapperInputRetreiver = PromiseWrapperInputRetreiverClosure();