import { Injectable } from '@angular/core';
import { Actions, Effect } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { PersistenceService } from '../../../../../core/persistence/persistence.service';
import { GitlabApiService } from '../gitlab-api/gitlab-api.service';
import { GlobalConfigService } from '../../../../config/global-config.service';
import { SnackService } from '../../../../../core/snack/snack.service';
import { TaskService } from '../../../../tasks/task.service';
import { ProjectService } from '../../../../project/project.service';
import { filter, first, map, switchMap, takeUntil, tap } from 'rxjs/operators';
import { forkJoin, Observable, timer } from 'rxjs';
import { GITLAB_INITIAL_POLL_DELAY, GITLAB_POLL_INTERVAL } from '../gitlab.const';
import { IssueService } from '../../../issue.service';
import { GITLAB_TYPE } from '../../../issue.const';
import { IssueEffectHelperService } from '../../../issue-effect-helper.service';
import { GitlabCfg } from '../gitlab';
import { T } from 'src/app/t.const';
import { TaskWithSubTasks } from '../../../../tasks/task.model';
import { WorkContextService } from '../../../../work-context/work-context.service';

const isGitlabEnabled = (gitlabCfg: GitlabCfg) => gitlabCfg && gitlabCfg.project && gitlabCfg.project.length > 2;

@Injectable()
export class GitlabIssueEffects {
  private _updateIssuesForCurrentContext$: Observable<any> = this._workContextService.allTasksForCurrentContext$.pipe(
    first(),
    switchMap((tasks) => {
      const gitIssueTasks = tasks.filter(task => task.issueType === GITLAB_TYPE);
      return forkJoin(gitIssueTasks.map(task => this._projectService.getGitlabCfgForProject$(task.projectId).pipe(
        first(),
        map(cfg => ({
          cfg,
          task,
        }))
        ))
      );
    }),
    map((cos) => cos
      .filter(({cfg, task}: { cfg: GitlabCfg, task: TaskWithSubTasks }) =>
        isGitlabEnabled(cfg) && cfg.isAutoPoll
      )
      .map(({task}: { cfg: GitlabCfg, task: TaskWithSubTasks }) => task)
    ),
    tap((gitlabTasks: TaskWithSubTasks[]) => gitlabTasks.forEach((gitlabTask) => {
      if (gitlabTasks && gitlabTasks.length > 0) {
        this._snackService.open({
          msg: T.F.GITLAB.S.POLLING,
          svgIco: 'gitlab',
          isSpinner: true,
        });
        gitlabTasks.forEach((task) =>
          this._issueService.refreshIssue(task, true, false));
      }
    })),
  );

  private _pollTimer$: Observable<any> = timer(GITLAB_INITIAL_POLL_DELAY, GITLAB_POLL_INTERVAL);

  @Effect({dispatch: false})
  pollNewIssuesToBacklog$: Observable<any> = this._issueEffectHelperService.pollToBacklogTriggerToProjectId$.pipe(
    switchMap((pId) => this._projectService.getGitlabCfgForProject$(pId).pipe(
      first(),
      filter(gitlabCfg => isGitlabEnabled(gitlabCfg) && gitlabCfg.isAutoAddToBacklog),
      switchMap(gitlabCfg => this._pollTimer$.pipe(
        // NOTE: required otherwise timer stays alive for filtered actions
        takeUntil(this._issueEffectHelperService.pollToBacklogActions$),
        tap(() => console.log('GITLAB!_POLL_BACKLOG_CHANGES')),
        tap(() => this._importNewIssuesToBacklog(pId, gitlabCfg)),
      )),
    )),
  );
  @Effect({dispatch: false})
  pollIssueChangesForCurrentContext$: Observable<any> = this._issueEffectHelperService.pollIssueTaskUpdatesActions$
    .pipe(
      switchMap(() => this._pollTimer$),
      switchMap(() => this._updateIssuesForCurrentContext$),
    );

  constructor(private readonly _actions$: Actions,
    private readonly _store$: Store<any>,
    private readonly _configService: GlobalConfigService,
    private readonly _snackService: SnackService,
    private readonly _projectService: ProjectService,
    private readonly _gitlabApiService: GitlabApiService,
    private readonly _issueService: IssueService,
    private readonly _taskService: TaskService,
    private readonly _workContextService: WorkContextService,
    private readonly _persistenceService: PersistenceService,
    private readonly _issueEffectHelperService: IssueEffectHelperService,
  ) {
  }

  private async _importNewIssuesToBacklog(projectId: string, gitlabCfg: GitlabCfg) {
    const issues = await this._gitlabApiService.getProjectData$(gitlabCfg).toPromise();
    const allTaskGitlabIssueIds = await this._taskService.getAllIssueIdsForProject(projectId, GITLAB_TYPE) as number[];
    const issuesToAdd = issues.filter(issue => !allTaskGitlabIssueIds.includes(issue.id));

    issuesToAdd.forEach((issue) => {
      this._issueService.addTaskWithIssue(GITLAB_TYPE, issue, projectId, true);
    });

    if (issuesToAdd.length === 1) {
      this._snackService.open({
        ico: 'cloud_download',
        translateParams: {
          issueText: `#${issuesToAdd[0].number} ${issuesToAdd[0].title}`
        },
        msg: T.F.GITLAB.S.IMPORTED_SINGLE_ISSUE,
      });
    } else if (issuesToAdd.length > 1) {
      this._snackService.open({
        ico: 'cloud_download',
        translateParams: {
          issuesLength: issuesToAdd.length
        },
        msg: T.F.GITLAB.S.IMPORTED_MULTIPLE_ISSUES,
      });
    }
  }
}
