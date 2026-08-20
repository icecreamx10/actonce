export type MidsceneRoundStatus = "PASS" | "FAIL" | "NOT_RUN";
export type MidscenePassSelection = "pass@1" | "pass@3";

export interface MidsceneAndroidWorldCase {
  id: number;
  task: string;
  rounds: readonly [MidsceneRoundStatus, MidsceneRoundStatus, MidsceneRoundStatus];
  finalStatus: "PASS" | "FAIL";
  firstPassRound: 1 | 2 | 3 | null;
}

export const MIDSCENE_ANDROID_WORLD_REPORT = {
  url: "https://midscenejs.com/android-world-benchmark-report",
  midsceneVersion: "1.9.5",
  model: "Gemini-3.5-Flash",
  androidWorldCommit: "3e50888527ef9f29b9157ecd537e408008bb1c85",
  publishedCounts: {
    totalTasks: 116,
    round1Reports: 115,
    passAt1: 108,
    passAt2: 111,
    passAt3: 113,
  },
} as const;

const TASKS = [
  "AudioRecorderRecordAudio",
  "AudioRecorderRecordAudioWithFileName",
  "BrowserDraw",
  "BrowserMaze",
  "BrowserMultiply",
  "CameraTakePhoto",
  "CameraTakeVideo",
  "ClockStopWatchPausedVerify",
  "ClockStopWatchRunning",
  "ClockTimerEntry",
  "ContactsAddContact",
  "ContactsNewContactDraft",
  "ExpenseAddMultiple",
  "ExpenseAddMultipleFromGallery",
  "ExpenseAddMultipleFromMarkor",
  "ExpenseAddSingle",
  "ExpenseDeleteDuplicates",
  "ExpenseDeleteDuplicates2",
  "ExpenseDeleteMultiple",
  "ExpenseDeleteMultiple2",
  "ExpenseDeleteSingle",
  "FilesDeleteFile",
  "FilesMoveFile",
  "MarkorAddNoteHeader",
  "MarkorChangeNoteContent",
  "MarkorCreateFolder",
  "MarkorCreateNote",
  "MarkorCreateNoteAndSms",
  "MarkorCreateNoteFromClipboard",
  "MarkorDeleteAllNotes",
  "MarkorDeleteNewestNote",
  "MarkorDeleteNote",
  "MarkorEditNote",
  "MarkorMergeNotes",
  "MarkorMoveNote",
  "MarkorTranscribeReceipt",
  "MarkorTranscribeVideo",
  "OpenAppTaskEval",
  "OsmAndFavorite",
  "OsmAndMarker",
  "OsmAndTrack",
  "RecipeAddMultipleRecipes",
  "RecipeAddMultipleRecipesFromImage",
  "RecipeAddMultipleRecipesFromMarkor",
  "RecipeAddMultipleRecipesFromMarkor2",
  "RecipeAddSingleRecipe",
  "RecipeDeleteDuplicateRecipes",
  "RecipeDeleteDuplicateRecipes2",
  "RecipeDeleteDuplicateRecipes3",
  "RecipeDeleteMultipleRecipes",
  "RecipeDeleteMultipleRecipesWithConstraint",
  "RecipeDeleteMultipleRecipesWithNoise",
  "RecipeDeleteSingleRecipe",
  "RecipeDeleteSingleWithRecipeWithNoise",
  "RetroCreatePlaylist",
  "RetroPlayingQueue",
  "RetroPlaylistDuration",
  "RetroSavePlaylist",
  "SaveCopyOfReceiptTaskEval",
  "SimpleCalendarAddOneEvent",
  "SimpleCalendarAddOneEventInTwoWeeks",
  "SimpleCalendarAddOneEventRelativeDay",
  "SimpleCalendarAddOneEventTomorrow",
  "SimpleCalendarAddRepeatingEvent",
  "SimpleCalendarDeleteEvents",
  "SimpleCalendarDeleteEventsOnRelativeDay",
  "SimpleCalendarDeleteOneEvent",
  "SimpleDrawProCreateDrawing",
  "SimpleSmsReply",
  "SimpleSmsReplyMostRecent",
  "SimpleSmsResend",
  "SimpleSmsSend",
  "SimpleSmsSendClipboardContent",
  "SimpleSmsSendReceivedAddress",
  "SystemBluetoothTurnOff",
  "SystemBluetoothTurnOffVerify",
  "SystemBluetoothTurnOn",
  "SystemBluetoothTurnOnVerify",
  "SystemBrightnessMax",
  "SystemBrightnessMaxVerify",
  "SystemBrightnessMin",
  "SystemBrightnessMinVerify",
  "SystemCopyToClipboard",
  "SystemWifiTurnOff",
  "SystemWifiTurnOffVerify",
  "SystemWifiTurnOn",
  "SystemWifiTurnOnVerify",
  "TurnOffWifiAndTurnOnBluetooth",
  "TurnOnWifiAndOpenApp",
  "VlcCreatePlaylist",
  "VlcCreateTwoPlaylists",
  "NotesIsTodo",
  "NotesMeetingAttendeeCount",
  "NotesRecipeIngredientCount",
  "NotesTodoItemCount",
  "SimpleCalendarAnyEventsOnDate",
  "SimpleCalendarEventOnDateAtTime",
  "SimpleCalendarEventsInNextWeek",
  "SimpleCalendarEventsInTimeRange",
  "SimpleCalendarEventsOnDate",
  "SimpleCalendarFirstEventAfterStartTime",
  "SimpleCalendarLocationOfEvent",
  "SimpleCalendarNextEvent",
  "SimpleCalendarNextMeetingWithPerson",
  "SportsTrackerActivitiesCountForWeek",
  "SportsTrackerActivitiesOnDate",
  "SportsTrackerActivityDuration",
  "SportsTrackerLongestDistanceActivity",
  "SportsTrackerTotalDistanceForCategoryOverInterval",
  "SportsTrackerTotalDurationForCategoryThisWeek",
  "TasksCompletedTasksForDate",
  "TasksDueNextWeek",
  "TasksDueOnDate",
  "TasksHighPriorityTasks",
  "TasksHighPriorityTasksDueOnDate",
  "TasksIncompleteTasksOnDate",
] as const;

const ROUND_1_NOT_RUN = new Set([41]);
const ROUND_1_FAIL = new Set([15, 37, 40, 43, 48, 49, 83]);
const ROUND_2 = new Map<number, "PASS" | "FAIL">([
  [37, "FAIL"], [40, "FAIL"], [41, "PASS"], [43, "PASS"],
  [48, "FAIL"], [49, "FAIL"], [83, "PASS"],
]);
const ROUND_3 = new Map<number, "PASS" | "FAIL">([
  [15, "PASS"], [37, "FAIL"], [40, "PASS"], [48, "FAIL"], [49, "FAIL"],
]);

export const MIDSCENE_ANDROID_WORLD_CASES: readonly MidsceneAndroidWorldCase[] = TASKS.map((task, index) => {
  const id = index + 1;
  const round1: MidsceneRoundStatus = ROUND_1_NOT_RUN.has(id)
    ? "NOT_RUN"
    : ROUND_1_FAIL.has(id) ? "FAIL" : "PASS";
  const rounds = [round1, ROUND_2.get(id) ?? "NOT_RUN", ROUND_3.get(id) ?? "NOT_RUN"] as const;
  const lastRun = [...rounds].reverse().find((status) => status !== "NOT_RUN");
  const firstPass = rounds.findIndex((status) => status === "PASS");
  return {
    id,
    task,
    rounds,
    finalStatus: lastRun === "PASS" ? "PASS" : "FAIL",
    firstPassRound: firstPass === -1 ? null : (firstPass + 1) as 1 | 2 | 3,
  };
});

export function selectMidsceneAndroidWorldCases(selection: MidscenePassSelection) {
  return MIDSCENE_ANDROID_WORLD_CASES.filter((entry) =>
    selection === "pass@1" ? entry.rounds[0] === "PASS" : entry.finalStatus === "PASS",
  );
}
