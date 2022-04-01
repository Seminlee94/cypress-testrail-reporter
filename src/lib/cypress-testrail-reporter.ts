import { reporters } from 'mocha';
import { TestRail } from './testrail';
import { titleToCaseIds } from './shared';
import { Status, TestRailResult } from './testrail.interface';
import { TestRailValidation } from './testrail.validation';
const TestRailCache = require('./testrail.cache');
const TestRailLogger = require('./testrail.logger');
import chalk = require('chalk');
import moment = require('moment');
var runCounter = 1;

export class CypressTestRailReporter extends reporters.Spec {
  private results: TestRailResult[] = [];
  private testRailApi: TestRail;
  private testRailValidation: TestRailValidation;
  private reporterOptions: any;
  private suiteId: any = [];
  private runId: number = 0;
  private serverTestCaseIds: any = [];

  constructor(runner: any, options: any) {
    super(runner);

    this.reporterOptions = options.reporterOptions;

    if (process.env.CYPRESS_TESTRAIL_REPORTER_USERNAME) {
      this.reporterOptions.username = process.env.CYPRESS_TESTRAIL_REPORTER_USERNAME;
    }

    if (process.env.CYPRESS_TESTRAIL_REPORTER_PASSWORD) {
      this.reporterOptions.password = process.env.CYPRESS_TESTRAIL_REPORTER_PASSWORD;
    }

    if (process.env.CYPRESS_TESTRAIL_REPORTER_RUNNAME) {
      this.reporterOptions.runName = process.env.CYPRESS_TESTRAIL_REPORTER_RUNNAME;
    }

    if (process.env.CYPRESS_TESTRAIL_REPORTER_GROUPID) {
      this.reporterOptions.runName = process.env.CYPRESS_TESTRAIL_REPORTER_GROUPID;
    }

    if (process.env.CYPRESS_TESTRAIL_RUN_ID) {
      TestRailCache.store('runId', process.env.CYPRESS_TESTRAIL_RUN_ID);
    }

    this.testRailApi = new TestRail(this.reporterOptions);
    this.testRailValidation = new TestRailValidation(this.reporterOptions);

    /**
     * This will validate reporter options defined in cypress.json file
     * if we are passing suiteId as a part of this file than we assign value to variable
     * usually this is the case for single suite projects
     */
    this.testRailValidation.validateReporterOptions(this.reporterOptions);
    if (this.reporterOptions.suiteId) {
      this.suiteId = this.reporterOptions.suiteId
    }
    /**
     * This will validate runtime environment variables
     * if we are passing suiteId as a part of runtime env variables we assign that value to variable
     * usually we use this way for multi suite projects
     */
    const cliArguments = this.testRailValidation.validateCLIArguments();
    if (cliArguments && cliArguments.length) {
      this.suiteId = cliArguments
    }

    /**
     * If no suiteId has been passed with previous two methods
     * runner will not be triggered
     */
    if (this.suiteId && this.suiteId.toString().length) {
      runner.on('start', () => {
        /**
        * runCounter is used to count how many spec files we have during one run
        * in order to wait for close test run function
        */
        TestRailCache.store('runCounter', runCounter);
        /**
        * creates a new TestRail Run
        * unless a cached value already exists for an existing TestRail Run in
        * which case that will be used and no new one created.
        */
        this.testRailApi.getRuns().then((res) => {
          const executionDateTime = moment().format('dddd, MMMM Do YYYY');
          const name = `${this.reporterOptions.runName || 'Automated regression test run'} ${executionDateTime}`;
          // if (!TestRailCache.retrieve('runId')) {
          if (this.testRailApi.runIds.some(run => run["name"] == name) == false) {
            console.log("run name", name);
            console.log("@@", this.testRailApi.runIds.some(run => run["name"] == name))
            TestRailLogger.warn('Starting with following options: ')
            console.debug(this.reporterOptions)
              if (this.reporterOptions.suiteId) {
                TestRailLogger.log(`Following suiteId has been set in cypress.json file: ${this.suiteId}`);
              }
              if (this.reporterOptions.disableDescription) {
                var description = '';
              } else {
                if (process.env.CYPRESS_CI_JOB_URL) {
                  var description = process.env.CYPRESS_CI_JOB_URL;
                } else {
                  var description = 'For the Cypress run visit https://dashboard.cypress.io/#/projects/runs';
                }
              }
              TestRailLogger.log(`Creating TestRail Run with name: ${name}`);
              this.testRailApi.createRun(name, description, this.suiteId);
          } 
          else {
            for (var runObj of this.testRailApi.runIds) {
              if (runObj["name"] == name) {
                console.log("runId@", runObj["id"])
                this.runId = runObj["id"]
                break;
              }
            }
              // use the cached TestRail Run ID
              // this.runId = TestRailCache.retrieve('runId');
            TestRailLogger.log(`Using existing TestRail Run with ID: '${this.runId}'`);
          }
        })
      });

      runner.on('pass', test => {
        this.submitResults(Status.Passed, test, `Execution time: ${test.duration}ms`);
      });

      runner.on('fail', (test, err) => {
        this.submitResults(Status.Failed, test, `${err.message}`);
      });

      runner.on('retry', test => {
        this.submitResults(Status.Retest, test, 'Cypress retry logic has been triggered!');
      });
    }
  }

  /**
   * Ensure that after each test results are reported continuously
   * Additionally to that if test status is failed or retried there is possibility 
   * to upload failed screenshot for easier debugging in TestRail
   * Note: Uploading of screenshot is configurable option
   */
  public submitResults (status, test, comment) {
    this.runId = 0 ? TestRailCache.retrieve('runId') : this.runId;
    console.log("submit results...", this.runId)
    let caseIds = titleToCaseIds(test.title)
    if (caseIds.length) {
      caseIds.map(caseId => {
        this.testRailApi.publishResult({
          run_id: this.runId,
          case_id: caseId,
          status_id: status,
          comment: `Execution time: ${test.duration}ms, case_id: ${caseId}`,
        })
        .then((response) => {
          if (this.reporterOptions.allowFailedScreenshotUpload === true && (status === Status.Failed || status === Status.Retest)) {
            this.testRailApi.uploadScreenshots(caseId, response[0].id);
         }
        })
      });
    }
  }
}
