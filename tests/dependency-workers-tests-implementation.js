'use strict';

QUnit.module('dependency-workers.js');

var results = [null, 'first result', 'second result'];

QUnit.test('Simple scenario without web workers', function(assert) {
    var workers = new dependencyWorkers.DependencyWorkers(createSimpleInputRetreiver(assert));
    var done = assert.async();

    workers.startTaskPromise({keyProp:2}).then(function(result) {
        assert.equal(result, results[2], 'Correctness of second task result');
        done();
    });
});

QUnit.test('SchedulerDependencyWorkers without web workers', function(assert) {
    var workers = new dependencyWorkers.SchedulerDependencyWorkers(new dependencyWorkers.DependencyWorkersTaskScheduler(1), createSimpleInputRetreiver(assert));
    var done = assert.async();
    
    workers.startTaskPromise({keyProp:2}).then(function(result) {
        assert.equal(result, results[2], 'Correctness of second task result');
        done();
    });
});

QUnit.test('Abort without dependent task', function(assert) {
    var scheduler = new dependencyWorkers.DependencyWorkersTaskScheduler(1);
    var dummyJobCallbacks;
    scheduler.enqueueJob(function dummyJob(resource, jobContext, callbacks) {
        dummyJobCallbacks = callbacks;
    }, { calculatePriority: function() { return 1; } }); // Enqueue the single free slot so next jobs will hold
    var priority = 1;
    var done = assert.async(4);
    var task2;
    var workers = new dependencyWorkers.SchedulerDependencyWorkers(scheduler, {
        taskStarted: function(task) {
            switch (task.key.keyProp) {
                case 1: task.dataReady(results[1], 1);
                        break;
                case 2: task2 = task;
                        break;
                case 3: assert.equal(task.key.keyProp, 3, 'taskKey should be 1, 2 or 3');
                        task.registerTaskDependency({keyProp: 1});
                        task.registerTaskDependency({keyProp: 2});
                        break;
            }
            task.on('dependencyTaskData', function() {
                assert.fail('Data not expected to be returned as job expected to be aborted');
            });
            task.on('custom', function(eventName) {
                if (eventName === 'aborting') {
                    done();
                }
            });
        },
        getWorkerTypeOptions: function(taskType) {
            if (taskType !== 1 && taskType !== 2) {
                assert.equal(taskType, 3, 'taskType should be 1, 2 or 3');
            }
            
            // Return non-null worker props so will not be recognized as no-worker-needed
            // and then the scheduler will be bypassed. However the worker props will never
            // be used because task is aborted before scheduling
            return {}; 
        },
        getKeyAsString: function(key) {
            return key.keyProp;
        }
    });
    
    var taskContext = workers.startTask({keyProp:3}, {
        onData: assert.fail,
        onTerminated: function(isAborted) {
            assert.equal(isAborted, true, 'Task expected to abort');
            done();
    } });
    
    taskContext.setPriorityCalculator(function() { return priority; });
    
    priority = -1;
    dummyJobCallbacks.jobDone();
});

function createSimpleInputRetreiver(assert) {
    return {
        taskStarted: function(task) {
            if (task.key.keyProp === 1) {
                task.dataReady(results[1], 1);
                task.terminate();
            } else {
                assert.equal(task.key.keyProp, 2, 'taskKey should be 1 or 2');
                task.registerTaskDependency({keyProp: 1});
                task.on('allDependTasksTerminated', function() {
                    assert.equal(task.dependTaskResults.length, 1, 'dependTaskResults of second task should be of length 1');
                    assert.equal(task.dependTaskResults[0], results[1], 'dependTaskResults[0] of second task should be the result of first task');
                    task.dataReady(results[2], 2);
                    task.terminate();
                });
            }
        },
        getWorkerTypeOptions: function(taskType) {
            if (taskType !== 1) {
                assert.equal(taskType, 2, 'taskType should be 1 or 2');
            }
            
            return null;
        },
        getKeyAsString: function(key) {
            return key.keyProp;
        }
    }
}