'use strict';

var prioritizer = {
    getPriority: function(task) {
        return task.calculatePriority();
    }
};

function createDummyResource() {
    return {};
}

function DependencyWorkersTaskScheduler(jobsLimit, options) {
    resourceScheduler.PriorityScheduler.call(this, createDummyResource, jobsLimit, prioritizer, options);
}

DependencyWorkersTaskScheduler.prototype = Object.create(resourceScheduler.PriorityScheduler.prototype);

module.exports = DependencyWorkersTaskScheduler;