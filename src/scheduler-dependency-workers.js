'use strict';

var DependencyWorkers = require('dependency-workers');

var SchedulerDependencyWorkers = (function SchedulerDependencyWorkersClosure() {
    function SchedulerDependencyWorkers(scheduler, inputRetreiver) {
        var that = this;
        DependencyWorkers.call(this, inputRetreiver);
        that._scheduler = scheduler;
        that._isDisableWorkerCache = [];
        that._inputRetreiver = inputRetreiver;
    }
    
    SchedulerDependencyWorkers.prototype = Object.create(DependencyWorkers.prototype);
    
    SchedulerDependencyWorkers.prototype.initializingTask = function initializingTask(taskApi, scheduleNotifier) {
        var that = this;
        taskApi.on('dependencyTaskCustom', function(customEventName, dependencyTaskKey) {
            if (customEventName !== 'aborting') {
                return;
            }
            
            if (!that._scheduler.shouldAbort(scheduleNotifier)) {
                throw 'Task ' + dependencyTaskKey + ' aborted but a task depends ' +
                    'on it didn\'t. Check scheduler consistency';
            }
            
            scheduleNotifier.abort(/*abortByScheduler=*/false);
        });
    };

    SchedulerDependencyWorkers.prototype.waitForSchedule = function waitForSchedule(scheduleNotifier, workerType) {
        if (this._isDisableWorkerCache[workerType] === undefined) {
            this._isDisableWorkerCache[workerType] = this._inputRetreiver.getWorkerTypeOptions(workerType) === null;
        }
        
        if (this._isDisableWorkerCache[workerType]) {
            DependencyWorkers.prototype.waitForSchedule.call(this, scheduleNotifier);
            return;
        }

        var isFinished = false;
        var jobCallbacks = null;
        var that = this;

        this._scheduler.enqueueJob(
            function onScheduled(resource, jobContext, jobCallbacks_) {
                if (jobContext !== scheduleNotifier) {
                    throw 'dependencyWorkers: Wrong jobContext - seems internal error in resource-scheduler.js';
                }
                
                if (isFinished) {
                    throw 'dependencyWorkers: scheduled after finish';
                }

                if (jobCallbacks !== null) {
                    throw 'dependencyWorkers: Scheduled twice';
                }
                
                jobCallbacks = jobCallbacks_;
                scheduleNotifier.schedule(jobCallbacks);
            },
            /*jobContext=*/scheduleNotifier,
            function onAborted() {
                if (isFinished) {
                    throw 'dependencyWorkers: abort after finish';
                }
                
                if (jobCallbacks !== null) {
                    throw 'dependencyWorkers: abort after scheduled';
                }
                
                jobCallbacks = null;
                isFinished = true;
                scheduleNotifier.abort(/*abortByScheduler=*/true);
            });
    };
    
    return SchedulerDependencyWorkers;
})();

module.exports = SchedulerDependencyWorkers;