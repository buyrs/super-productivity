import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { TaskService } from '../../features/tasks/task.service';
import { ActivatedRoute, Router } from '@angular/router';
import { IS_ELECTRON } from '../../app.constants';
import { MatDialog } from '@angular/material/dialog';
import { Observable, Subscription } from 'rxjs';
import { IPC } from '../../../../electron/ipc-events.const';
import { DialogConfirmComponent } from '../../ui/dialog-confirm/dialog-confirm.component';
import { NoteService } from '../../features/note/note.service';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { GoogleDriveSyncService } from '../../features/google/google-drive-sync.service';
import { SnackService } from '../../core/snack/snack.service';
import { filter, map, shareReplay, startWith, switchMap, take } from 'rxjs/operators';
import { GoogleApiService } from '../../features/google/google-api.service';
import { ProjectService } from '../../features/project/project.service';
import { getWorklogStr } from '../../util/get-work-log-str';
import * as moment from 'moment';
import { RoundTimeOption } from '../../features/project/project.model';
import { T } from '../../t.const';
import { WorklogService } from '../../features/worklog/worklog.service';
import { DialogWorklogExportComponent } from '../../features/worklog/dialog-worklog-export/dialog-worklog-export.component';
import { ElectronService } from '../../core/electron/electron.service';
import { WorkContextService } from '../../features/work-context/work-context.service';
import { DropboxSyncService } from '../../features/dropbox/dropbox-sync.service';
import { Task } from '../../features/tasks/task.model';

const SUCCESS_ANIMATION_DURATION = 500;

@Component({
  selector: 'daily-summary',
  templateUrl: './daily-summary.component.html',
  styleUrls: ['./daily-summary.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DailySummaryComponent implements OnInit, OnDestroy {
  T: any = T;

  cfg: any = {
    isBlockFinishDayUntilTimeTimeTracked: false
  };

  isTimeSheetExported: boolean = true;
  showSuccessAnimation: boolean;
  selectedTabIndex: number = 0;
  isForToday: boolean = true;

  dayStr: string = getWorklogStr();

  dayStr$: Observable<string> = this._activatedRoute.paramMap.pipe(
    startWith({params: {dayStr: getWorklogStr()}}),
    map((s: any) => {
      if (s && s.params.dayStr) {
        return s.params.dayStr;
      } else {
        return getWorklogStr();
      }
    }),
    shareReplay(1)
  );

  tasksWorkedOnOrDoneOrRepeatableFlat$: Observable<Task[]> = this.dayStr$.pipe(
    switchMap((dayStr) => this.workContextService.getDailySummaryTasksFlat$(dayStr)),
    shareReplay(1),
  );

  hasTasksForToday$: Observable<boolean> = this.tasksWorkedOnOrDoneOrRepeatableFlat$.pipe(map(tasks => tasks && !!tasks.length));

  nrOfDoneTasks$: Observable<number> = this.tasksWorkedOnOrDoneOrRepeatableFlat$.pipe(
    map(tasks => tasks && tasks.filter(task => !!task.isDone).length),
  );

  totalNrOfTasks$: Observable<number> = this.tasksWorkedOnOrDoneOrRepeatableFlat$.pipe(
    map(tasks => tasks && tasks.length),
  );

  estimatedOnTasksWorkedOn$: Observable<number> = this.dayStr$.pipe(switchMap((dayStr) => this.workContextService.getTimeEstimateForDay$(dayStr)));

  timeWorked$: Observable<number> = this.dayStr$.pipe(switchMap((dayStr) => this.workContextService.getTimeWorkedForDay$(dayStr)));

  started$: Observable<number> = this.dayStr$.pipe(switchMap((dayStr) => this.workContextService.getWorkStart$(dayStr)));
  end$: Observable<number> = this.dayStr$.pipe(switchMap((dayStr) => this.workContextService.getWorkEnd$(dayStr)));

  breakTime$: Observable<number> = this.dayStr$.pipe(switchMap((dayStr) => this.workContextService.getBreakTime$(dayStr)));
  breakNr$: Observable<number> = this.dayStr$.pipe(switchMap((dayStr) => this.workContextService.getBreakNr$(dayStr)));

  isBreakTrackingSupport$: Observable<boolean> = this.configService.idle$.pipe(map(cfg => cfg && cfg.isEnableIdleTimeTracking));

  private _successAnimationTimeout: number;

  // calc time spent on todays tasks today
  private _subs: Subscription = new Subscription();

  constructor(
    public readonly configService: GlobalConfigService,
    public readonly workContextService: WorkContextService,
    private readonly _taskService: TaskService,
    private readonly _googleDriveSync: GoogleDriveSyncService,
    private readonly _dropboxSync: DropboxSyncService,
    private readonly _router: Router,
    private readonly _noteService: NoteService,
    private readonly _matDialog: MatDialog,
    private readonly _snackService: SnackService,
    private readonly _projectService: ProjectService,
    private readonly _googleApiService: GoogleApiService,
    private readonly _electronService: ElectronService,
    private readonly _worklogService: WorklogService,
    private readonly _cd: ChangeDetectorRef,
    private readonly _activatedRoute: ActivatedRoute,
  ) {
    this._taskService.setSelectedId(null);
  }

  ngOnInit() {
    // we need to wait, otherwise data would get overwritten
    this._subs.add(this._taskService.currentTaskId$.pipe(
      filter(id => !!id),
      take(1),
    ).subscribe(() => {
      this._taskService.setCurrentId(null);
    }));

    this._subs.add(this._activatedRoute.paramMap.subscribe((s: any) => {
        if (s && s.params.dayStr) {
          this.isForToday = false;
          this.dayStr = s.params.dayStr;
        }
      })
    );
  }

  ngOnDestroy() {
    this._subs.unsubscribe();
    // should not happen, but just in case
    if (this._successAnimationTimeout) {
      window.clearTimeout(this._successAnimationTimeout);
    }
  }

  onEvaluationSave() {
    this.selectedTabIndex = 1;
  }

  showExportModal() {
    this._matDialog.open(DialogWorklogExportComponent, {
      restoreFocus: true,
      panelClass: 'big',
      data: {
        rangeStart: new Date().setHours(0, 0, 0, 0),
        rangeEnd: new Date().setHours(23, 59, 59),
      }
    });
  }

  async finishDay() {
    const doneTasks = await this.workContextService.doneTasks$.pipe(take(1)).toPromise();

    this._taskService.moveToArchive(doneTasks);

    if (IS_ELECTRON && this.isForToday) {
      this._matDialog.open(DialogConfirmComponent, {
        restoreFocus: true,
        data: {
          okTxt: T.PDS.D_CONFIRM_APP_CLOSE.OK,
          cancelTxt: T.PDS.D_CONFIRM_APP_CLOSE.CANCEL,
          message: T.PDS.D_CONFIRM_APP_CLOSE.MSG,
        }
      }).afterClosed()
        .subscribe((isConfirm: boolean) => {
          if (isConfirm) {
            this._finishDayForGood(() => {
              this._electronService.ipcRenderer.send(IPC.SHUTDOWN_NOW);
            });
          } else if (isConfirm === false) {
            this._finishDayForGood(() => {
              this._router.navigate(['/active/tasks']);
            });
          }
        });
    } else {
      this._finishDayForGood(() => {
        this._router.navigate(['/active/tasks']);
      });
    }
  }

  updateWorkStart(ev: string) {
    const startTime = moment(this.dayStr + ' ' + ev).unix() * 1000;
    if (startTime) {
      this.workContextService.updateWorkStartForActiveContext(this.dayStr, startTime);
    }
  }

  updateWorkEnd(ev: string) {
    const endTime = moment(this.dayStr + ' ' + ev).unix() * 1000;
    if (endTime) {
      this.workContextService.updateWorkEndForActiveContext(this.dayStr, endTime);
    }
  }

  async roundTimeForTasks(roundTo: RoundTimeOption, isRoundUp: boolean = false) {
    const taskIds = await this.tasksWorkedOnOrDoneOrRepeatableFlat$.pipe(
      map(tasks => tasks.map(task => task.id)),
      take(1),
    ).toPromise();
    this._taskService.roundTimeSpentForDay(this.dayStr, taskIds, roundTo, isRoundUp);
  }

  onTabIndexChange(i: number) {
    this.selectedTabIndex = i;
  }

  onTaskSummaryEdit() {
    this._worklogService.refreshWorklog();
  }

  private async _finishDayForGood(cb?: any) {
    if (this.configService.cfg
      && this.configService.cfg.googleDriveSync.isEnabled
      && this.configService.cfg.googleDriveSync.isAutoSyncToRemote) {
      // login in again, will hopefully prevent google errors
      // this._googleApiService.login().then(() => {
      this._googleDriveSync.saveForSync();
      await this._googleDriveSync.onSaveEnd$.pipe(take(1)).toPromise();
      this._initSuccessAnimation(cb);
      // });
    } else if (this.configService.cfg
      && this.configService.cfg.dropboxSync
      && this.configService.cfg.dropboxSync.isEnabled && this.configService.cfg.dropboxSync.accessToken) {
      await this._dropboxSync.sync();
      this._initSuccessAnimation(cb);
    } else {
      this._initSuccessAnimation(cb);
    }
  }

  private _initSuccessAnimation(cb?: any) {
    this.showSuccessAnimation = true;
    this._cd.detectChanges();
    this._successAnimationTimeout = window.setTimeout(() => {
      this.showSuccessAnimation = false;
      this._cd.detectChanges();
      if (cb) {
        cb();
      }
    }, SUCCESS_ANIMATION_DURATION);
  }
}
