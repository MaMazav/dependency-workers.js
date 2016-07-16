'use strict';

function PromiseDependencyWorkersClosure() {
    var asyncProxyScriptBlob = self['asyncProxyScriptBlob'];
    
    function PromiseDependencyWorkers(scriptsToImport, ctorName, ctorArgs, promiseInputRetreiver) {
        var inputRetreiver = createInputRetreiverWrapper(promiseInputRetreiver);
        DependencyWorkers.call(this, scriptsToImport, ctorName, ctorArgs, inputRetreiver);
        
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
    }
    
    PromiseDependencyWorkers.prototype = Object.create(DependencyWorkers.prototype);
    
    PromiseDependencyWorkers.prototype.startTaskPromise =
            function startTaskPromise(taskKey) {
        
        var that = this;
        return new Promise(function(resolve, reject) {
            var taskHandle = that.startTask(
                taskKey, { 'onData': onData, 'onTerminated': onTerminated });
            
            var hasData = taskHandle.hasData();
            var result;
            if (hasData) {
                result = taskHandle.getLastData();
            }
            
            function onData(data) {
                hasData = true;
                result = data;
            }
            
            function onTerminated() {
                if (hasData) {
                    resolve(result);
                } else {
                    reject('AsyncProxy.PromiseDependencyWorkers: Internal ' +
                        'error - task terminated but no data returned');
                }
            }
        });
    };
    
    function createInputRetreiverWrapper(promiseInputRetreiver) {
        return {
            _promiseInputRetreiver: promiseInputRetreiver,
            'createTaskContext': function(taskKey, callbacks) {
                var that = this;
                var dependsOnTasks = that._promiseInputRetreiver['getDependsOnTasks'](taskKey);
                    
                return new PromiseTask(
                    taskKey, dependsOnTasks, that._promiseInputRetreiver, callbacks);
            },
            'getHashCode': function(key) {
                var that = this;
                return that._promiseInputRetreiver['getHashCode'](key);
            },
            
            'isEqual': function(key1, key2) {
                var that = this;
                return that._promiseInputRetreiver['isEqual'](key1, key2);
            }
        };
    }
    
    asyncProxyScriptBlob.addMember(PromiseDependencyWorkersClosure, 'PromiseDependencyWorkers');
    
    return PromiseDependencyWorkers;
}

var PromiseDependencyWorkers = PromiseDependencyWorkersClosure();