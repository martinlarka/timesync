var colors = require('colors/safe');
var config = require('config')
var keypress = require('keypress');
var program = require('commander');
var rp = require('request-promise');
var schedule = require('node-schedule');
var _ = require('underscore');

const JIRAWORKLOG = '/rest/tempo-timesheets/3/worklogs/';
const JIRAAUTH = '/rest/auth/1/session';
const JIRAISSUE = '/rest/api/2/issue/';

function list(val) {
  return val.split(',');
}

program
  .version('0.0.1')
  .option('-v, --verbose', 	'Extensive logging')
  .option('-p, --period <items>', 'Only search specified period XXXX-XX-XX,XXXX-XX-XX', list)
  .parse(process.argv);

var auth =  new Buffer(username + ":" + password).toString("base64");
var t2auth = new Buffer(username + ":" + password).toString("base64");
var author = {};
var ticket = {};

if (!program.period) {
	var j = schedule.scheduleJob('0 08-19 * * *', function() {
		doLog('Scheduled search');
		if (author !== {} && ticket !== {} && ticket !== {}) {
			// Searching current month
			updateWorklog();
		} else {
			doLog(colors.red('ERROR: Author not fetched'));
		}
	});

	keypress(process.stdin); 
	process.stdin.on('keypress', function (ch, key) {
		if (key && key.ctrl && key.name == 'c') {
	    	process.stdin.pause();
	    	j.cancel();
		}

		// Update last day
		if (key && key.name == 'a') {
			if (author !== {} && ticket !== {}) {
				updateWorklog(new Date(new Date().setDate(new Date().getDate()-1)).toLocaleDateString());
			} else {
				doLog(colors.red('ERROR: Author not fetched'));
			}
		}
		// Update last week
		if (key && key.name == 's') {
			if (author !== {} && ticket !== {}) {
				updateWorklog(new Date(new Date().setDate(new Date().getDate()-7)).toLocaleDateString());
			} else {
				doLog(colors.red('ERROR: Author not fetched'));
			}
		}
		// Update this month
		if (key && key.name == 'd') {
			if (author !== {} && ticket !== {}) {
				updateWorklog();
			} else {
				doLog(colors.red('ERROR: Author not fetched'));
			}
		}
		// Post worklog - comp
		if (key && key.name == 'h') {
			console.log('#### Help #####\nSchedule set to run every hour between 7-19\nManual updating: a => day, s => week d => month')
		}
	});
	process.stdin.setRawMode(true);
	process.stdin.resume();
}

var promise = Promise.all([rp(compSelf()),rp(getTicket(config.compentusTask))]);
promise.then(function (r) {
	logMessage(colors.green('Author fetched'));
	author = JSON.parse(r[0]);
	ticket = JSON.parse(r[1]);
	if (program.period) {
		// Only search specified period
		updateWorklog(program.period[0], program.period[1]);
	}
	}).catch(function (err) {
			doLog(colors.red.underline('Failed during Get Author or ticket'));
});

function updateWorklog(dateFrom, dateTo) {
	// Get worklogs
	var from = dateFrom ? dateFrom :  new Date(new Date().setDate(1)).toLocaleDateString();
	var to = dateTo ? dateTo : new Date().toLocaleDateString();

	logMessage(colors.blue('Updating from '+ from +' to ' + to + ' on ticket: ' + ticket.key + ' ' + ticket.fields.summary));

	var pAll = Promise.all([rp(tele2Work(from, to)),rp(compWork(from, to))]);
	pAll.then(function(r) {
		var res = r.map((response) => { return JSON.parse(response)});
		var group = _.groupBy(res[0], (wlog)=> {return wlog.dateStarted.split('T')[0]});
		var totalMinutes = 0;

		for (var key in group) {
			logMessage(colors.magenta('Searching date: ' + key));
			
			var result = _.filter(res[1], (wlog)=> { return wlog.dateStarted.split('T')[0] == key && wlog.issue.key == config.compentusTask});
			// DIFF
			var loggedComp =  _.reduce(_.pluck(result, 'timeSpentSeconds'), (m,n) => { return m + n;}, 0);
			var loggedTele2 = _.reduce(_.pluck(group[key], 'timeSpentSeconds'), (m,n) => { return m + n;}, 0);
			if (loggedComp !== loggedTele2) {
				var comment = _.map(group[key], (x) => {return x.issue.key}).join(', ');
				// UPDATE COMP WORKLOG
				if (result.length === 0 || loggedComp === 0) {
					// POST
					logMessage(colors.green('Adding ' + (loggedTele2/3600) + 'h on ' + config.compentusTask + ': ' + comment));
					rp(postWork(loggedTele2, key + 'T00:00:00.000', comment, author)).catch((err)=>{doLog(colors.red.underline('Failed during post work'))});
				} else {
					// PUT
					if (result.length > 1) {
						// Handle multiple comp tickets
						adjustCompLogs(result, loggedTele2, loggedComp, comment);
					} else {
						// Update worklog
						logMessage(colors.green('Updating from ' + (result[0].timeSpentSeconds/3600) + 'h to ' + (loggedTele2/3600) + 'h on ' + config.compentusTask + ': ' + comment));
						rp(putWork(result[0].id, loggedTele2, comment)).catch((err)=>{doLog(colors.red.underline('Failed during put work'))});
					}
				}
			}
			totalMinutes += loggedTele2;
		}
		doLog(colors.magenta('Total hours logged: ' + totalMinutes/3600));
	}, function(err) {
		doLog(colors.red.underline('Failed during get work'));
	});
}

function adjustCompLogs(result, loggedTele2, loggedComp, comment) {
	var maxTicket = _.max(result, (wlog) => { return wlog.timeSpentSeconds;})
	if (loggedComp - maxTicket.timeSpentSeconds >= loggedTele2) {
		// Delete largest and try again
		logMessage(colors.red('Deleting ' + (maxTicket.timeSpentSeconds/3600) + 'h [' + maxTicket.comment + ']'));
		rp(delWork(maxTicket.id)).catch((err)=>{doLog(colors.red.underline('Failed during delete work'))});

		adjustCompLogs(_.reject(result, (x)=> { return x.id === maxTicket.id; }), loggedTele2, loggedComp - maxTicket.timeSpentSeconds, comment)
	} else {
		// Update largest
		logMessage(colors.blue('Updating from ' + (maxTicket.timeSpentSeconds/3600) + 'h to ' + ((loggedTele2 - loggedComp + maxTicket.timeSpentSeconds)/3600) + 'h on ' + config.compentusTask + ':' + comment));
		rp(putWork(result[0].id, (loggedComp - maxTicket.timeSpentSeconds + loggedTele2), comment)).catch((err)=>{doLog(colors.red.underline('Failed during put work'))});
	}
}

function doLog(err) {
	var d = new Date();
	console.log(colors.white(d.toLocaleDateString() + ' ' + d.toLocaleTimeString()) + ' ' + err);
}

function logMessage(msg) {
	if (program.verbose) {
		doLog(msg);
	}
}

function compSelf() {
	return { method: 'GET',
		  	url:  config.compentusUrl + JIRAAUTH,
			headers: 
			   	{ 'cache-control': 'no-cache',
			   	authorization: auth,
			   	accept: 'application/json' } };
}

function getTicket(ticket) {
	return { method: 'GET',
		  	url:  config.compentusUrl + JIRAISSUE + ticket,
			headers: 
			   	{ 'cache-control': 'no-cache',
			   	authorization: auth,
			   	accept: 'application/json' } };
}

function tele2Work(from, to) {
	return { method: 'GET',
		  url: config.tele2Url + JIRAWORKLOG,
		  qs: 
		   { username: config.tele2User,
		     dateFrom: from,
		     dateTo: to },
		  headers: 
		   { 'cache-control': 'no-cache',
		   	 authorization: t2auth,
		     accept: 'application/json' } 
		 };
}

function compWork(from, to) {
	return { method: 'GET',
		  url: config.compentusUrl + JIRAWORKLOG,
		  qs: 
		   { username: author.name,
		     dateFrom: from,
		     dateTo: to },
		  headers: 
		   { 'cache-control': 'no-cache',
		     authorization: auth,
		     accept: 'application/json' } };
}

function postWork(timeSpent, dateStarted, comment, author) {
	return { method: 'POST',
			  url: config.compentusUrl + JIRAWORKLOG,
			  headers: 
			   { 'cache-control': 'no-cache',
			     'content-type': 'application/json',
			     authorization: auth,
			     accept: 'application/json' },
			  body: 
			   { timeSpentSeconds: timeSpent, 
			     dateStarted: dateStarted, 
			     comment: comment, 
			     author: {
			     	self: author.self,
			     	name: author.name
			     },
			     issue: { key: config.compentusTask, remainingEstimateSeconds: 0 },
			     worklogAttributes: [],
			     workAttributeValues: [] },
			  json: true };
}

function putWork(logId, timeSpent, comment) {
	return { method: 'PUT',
				url: config.compentusUrl + JIRAWORKLOG + logId,
			  headers: 
			   { 'cache-control': 'no-cache',
			     'content-type': 'application/json',
			     authorization: auth,
			     accept: 'application/json' },
			  body: 
			   { timeSpentSeconds: timeSpent, 
			     comment: comment, 
			     issue: { remainingEstimateSeconds: 0 } },
			  json: true };
}

function delWork(logId) {
	return { method: 'DELETE',
				url: config.compentusUrl + JIRAWORKLOG + logId,
			  headers: 
			   { 'cache-control': 'no-cache',
			     'content-type': 'application/json',
			     authorization: auth,
			     accept: 'application/json' },
			  json: true };
}


