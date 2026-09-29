Attribute VB_Name = "Scheduling"
Option Explicit

'============================================================
' SCHEDULING DATE VIEWS
' Revised 09-Sep-2026
' - Yesterday / Today / Tomorrow are standalone date views
' - Clears previous filters first
' - Uses >= selected date and < next date
' - Sorts selected day by Time -> Batch ID
' - Batch ID is resolved from Email Database in memory
' - Temporary helper column is always removed
'============================================================

Private Sub FilterLessonDate(ByVal targetDate As Date)
    Dim ws As Worksheet
    Dim lo As ListObject
    Dim tempCol As ListColumn

    Dim colLessonDate As Long
    Dim colTime As Long
    Dim colName As Long
    Dim colSubject As Long
    Dim colTutor As Long
    Dim dateField As Long

    Dim firstRow As Long
    Dim lastRow As Long
    Dim rowCount As Long
    Dim i As Long

    Dim arrName As Variant
    Dim arrSubject As Variant
    Dim arrDate As Variant
    Dim arrTime As Variant
    Dim arrTutor As Variant
    Dim arrBatch() As Variant

    Dim batchMap As Object
    Dim key As String
    Dim errMsg As String

    Dim oldCalc As XlCalculation
    Dim oldScreenUpdating As Boolean
    Dim oldEnableEvents As Boolean

    On Error GoTo Fail

    Set ws = ThisWorkbook.Worksheets("Live")
    ws.Activate

    If ws.ListObjects.Count = 0 Then
        MsgBox "No Live table was found.", vbExclamation, "Future Perfect"
        Exit Sub
    End If

    Set lo = ws.ListObjects(1)
    If lo.DataBodyRange Is Nothing Then Exit Sub

    oldCalc = Application.Calculation
    oldScreenUpdating = Application.ScreenUpdating
    oldEnableEvents = Application.EnableEvents

    Application.ScreenUpdating = False
    Application.EnableEvents = False
    Application.Calculation = xlCalculationManual
    Application.StatusBar = "Preparing date view..."

    ClearLiveFilters ws, lo

    colLessonDate = FPT_HeaderCol(ws, "Lesson date", "LessonDated")
    colTime = FPT_HeaderCol(ws, "Time")
    colName = FPT_HeaderCol(ws, "Name")
    colSubject = FPT_HeaderCol(ws, "Subject")
    colTutor = FPT_HeaderCol(ws, "Tutor")

    If colLessonDate = 0 Or colTime = 0 Or colName = 0 Or _
       colSubject = 0 Or colTutor = 0 Then
        Err.Raise vbObjectError + 3101, "Scheduling.FilterLessonDate", _
                  "One or more required Live columns could not be found."
    End If

    dateField = colLessonDate - lo.Range.Column + 1

    lo.Range.AutoFilter _
        Field:=dateField, _
        Criteria1:=">=" & CLng(Fix(CDbl(targetDate))), _
        Operator:=xlAnd, _
        Criteria2:="<" & CLng(Fix(CDbl(targetDate + 1)))

    'Remove a helper column left behind by any interrupted run.
    On Error Resume Next
    Set tempCol = lo.ListColumns("__BatchSort")
    If Not tempCol Is Nothing Then tempCol.Delete
    Set tempCol = Nothing
    On Error GoTo Fail

    firstRow = lo.DataBodyRange.Row
    rowCount = lo.DataBodyRange.rows.Count
    lastRow = firstRow + rowCount - 1

    Application.StatusBar = "Resolving batch order..."

    Set batchMap = BuildBatchSortMap()

    arrName = ws.Range(ws.Cells(firstRow, colName), ws.Cells(lastRow, colName)).value2
    arrSubject = ws.Range(ws.Cells(firstRow, colSubject), ws.Cells(lastRow, colSubject)).value2
    arrDate = ws.Range(ws.Cells(firstRow, colLessonDate), ws.Cells(lastRow, colLessonDate)).value2
    arrTime = ws.Range(ws.Cells(firstRow, colTime), ws.Cells(lastRow, colTime)).value2
    arrTutor = ws.Range(ws.Cells(firstRow, colTutor), ws.Cells(lastRow, colTutor)).value2

    ReDim arrBatch(1 To rowCount, 1 To 1)

    For i = 1 To rowCount
        key = LiveMembershipKey( _
                    arrName(i, 1), _
                    arrSubject(i, 1), _
                    arrDate(i, 1), _
                    arrTime(i, 1), _
                    arrTutor(i, 1))

        If key <> "" And batchMap.Exists(key) Then
            arrBatch(i, 1) = batchMap(key)
        Else
            arrBatch(i, 1) = ""
        End If
    Next i

    Set tempCol = lo.ListColumns.Add
    tempCol.Name = "__BatchSort"
    tempCol.DataBodyRange.value2 = arrBatch

    Application.StatusBar = "Sorting by time and batch..."

    With lo.Sort
        .SortFields.Clear

        .SortFields.Add _
            key:=ws.Range( _
                ws.Cells(firstRow, colTime), _
                ws.Cells(lastRow, colTime)), _
            SortOn:=xlSortOnValues, _
            Order:=xlAscending, _
            DataOption:=xlSortNormal

        .SortFields.Add _
            key:=tempCol.DataBodyRange, _
            SortOn:=xlSortOnValues, _
            Order:=xlAscending, _
            DataOption:=xlSortNormal

        .Header = xlYes
        .MatchCase = False
        .Orientation = xlTopToBottom
        .Apply
    End With

CleanExit:
    On Error Resume Next
    If Not tempCol Is Nothing Then tempCol.Delete
    Application.StatusBar = False
    Application.Calculation = oldCalc
    Application.EnableEvents = oldEnableEvents
    Application.ScreenUpdating = oldScreenUpdating
    On Error GoTo 0
    Exit Sub

Fail:
    errMsg = Err.Description
    On Error Resume Next
    If Not tempCol Is Nothing Then tempCol.Delete
    Application.StatusBar = False
    Application.Calculation = oldCalc
    Application.EnableEvents = oldEnableEvents
    Application.ScreenUpdating = oldScreenUpdating
    On Error GoTo 0

    MsgBox "The date view could not be applied:" & vbCrLf & vbCrLf & _
           errMsg, vbExclamation, "Future Perfect"
End Sub

Private Sub ClearLiveFilters(ByVal ws As Worksheet, ByVal lo As ListObject)
    On Error Resume Next
    If lo.AutoFilter.FilterMode Then lo.AutoFilter.ShowAllData
    If ws.FilterMode Then ws.ShowAllData
    ws.UsedRange.EntireRow.Hidden = False
    On Error GoTo 0
End Sub

'Name + Subject + Day + Time + Tutor -> Batch ID.
Private Function BuildBatchSortMap() As Object
    Dim wsDB As Worksheet
    Dim d As Object
    Dim lastRow As Long
    Dim r As Long
    Dim key As String
    Dim batchId As String

    Set wsDB = ThisWorkbook.Worksheets(FPT_DB_SHEET)
    Set d = CreateObject("Scripting.Dictionary")
    d.CompareMode = vbTextCompare

    lastRow = wsDB.Cells(wsDB.rows.Count, "A").End(xlUp).Row

    For r = 3 To lastRow
        If Trim$(CStr(wsDB.Cells(r, "A").value2)) <> "" Then
            key = DBMembershipKey( _
                        wsDB.Cells(r, "A").value2, _
                        wsDB.Cells(r, "B").value2, _
                        wsDB.Cells(r, "C").value2, _
                        wsDB.Cells(r, "D").value, _
                        wsDB.Cells(r, "J").value2)

            batchId = Trim$(CStr(wsDB.Cells(r, "H").value2))

            If key <> "" And batchId <> "" Then
                If d.Exists(key) Then
                    d(key) = ""
                Else
                    d.Add key, batchId
                End If
            End If
        End If
    Next r

    Set BuildBatchSortMap = d
End Function

Private Function DBMembershipKey( _
                    ByVal studentName As Variant, _
                    ByVal subjectName As Variant, _
                    ByVal dayValue As Variant, _
                    ByVal timeValue As Variant, _
                    ByVal tutorName As Variant) As String

    Dim timeToken As String
    timeToken = MembershipTimeToken(timeValue)

    If FPT_Norm(studentName) = "" Or _
       FPT_Norm(subjectName) = "" Or _
       FPT_Norm(dayValue) = "" Or _
       timeToken = "" Then Exit Function

    DBMembershipKey = _
        FPT_Norm(studentName) & Chr$(30) & _
        FPT_Norm(subjectName) & Chr$(30) & _
        FPT_Norm(dayValue) & Chr$(30) & _
        timeToken & Chr$(30) & _
        FPT_Norm(tutorName)
End Function

Private Function LiveMembershipKey( _
                    ByVal studentName As Variant, _
                    ByVal subjectName As Variant, _
                    ByVal lessonDateValue As Variant, _
                    ByVal timeValue As Variant, _
                    ByVal tutorName As Variant) As String

    Dim dayText As String
    Dim timeToken As String

    On Error GoTo BadKey

    If IsDate(lessonDateValue) Or IsNumeric(lessonDateValue) Then
        dayText = Format$(CDate(lessonDateValue), "dddd")
    Else
        Exit Function
    End If

    timeToken = MembershipTimeToken(timeValue)

    If FPT_Norm(studentName) = "" Or _
       FPT_Norm(subjectName) = "" Or _
       dayText = "" Or _
       timeToken = "" Then Exit Function

    LiveMembershipKey = _
        FPT_Norm(studentName) & Chr$(30) & _
        FPT_Norm(subjectName) & Chr$(30) & _
        FPT_Norm(dayText) & Chr$(30) & _
        timeToken & Chr$(30) & _
        FPT_Norm(tutorName)

    Exit Function

BadKey:
    LiveMembershipKey = ""
End Function

Private Function MembershipTimeToken(ByVal v As Variant) As String
    Dim k As Double

    k = FPT_TimeKey(v)
    If k < 0 Then Exit Function

    MembershipTimeToken = CStr(CLng(Round(k * 1440, 0)))
End Function

Public Sub Yest(Optional ByVal control As IRibbonControl)

    FilterLessonDate Date - 1

    With ThisWorkbook.Worksheets("Live")
        .Columns("F").Hidden = False
        .Columns("H").Hidden = False
    End With

End Sub

Public Sub Tod(Optional ByVal control As IRibbonControl)

    FilterLessonDate Date

    'In-class view:
    'Hide Quoted and Received.
    With ThisWorkbook.Worksheets("Live")
        .Columns("F").Hidden = True
        .Columns("H").Hidden = True
    End With

End Sub

Public Sub Tomm(Optional ByVal control As IRibbonControl)

    FilterLessonDate Date + 1

    With ThisWorkbook.Worksheets("Live")
        .Columns("F").Hidden = False
        .Columns("H").Hidden = False
    End With

End Sub
