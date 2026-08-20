Attribute VB_Name = "InsertStyleImages"
Option Explicit

' ============================================================
'  舜天汉唐 - 样衣管理：款式图批量插入工具
'  功能：
'    1. 导入数据 - 从导出的xlsx文件导入样衣数据
'    2. 插入款式图 - 从picture文件夹按款号查找图片并插入
'    3. 清除款式图 - 清除所有已插入的款式图
' ============================================================

Sub 导入数据()
    Dim ws As Worksheet
    Dim filePath As String
    Dim srcWb As Workbook, srcWs As Worksheet
    Dim lastRow As Long, lastCol As Long
    Dim i As Long, j As Long

    Set ws = ThisWorkbook.Sheets(1)

    With Application.FileDialog(msoFileDialogFilePicker)
        .Title = "请选择从样衣管理系统导出的Excel文件"
        .Filters.Clear
        .Filters.Add "Excel文件", "*.xlsx;*.xls"
        .AllowMultiSelect = False
        If .Show = -1 Then
            filePath = .SelectedItems(1)
        Else
            MsgBox "未选择文件，操作已取消", vbExclamation, "提示"
            Exit Sub
        End If
    End With

    Application.ScreenUpdating = False
    Application.DisplayAlerts = False

    Set srcWb = Workbooks.Open(filePath)
    Set srcWs = srcWb.Sheets(1)

    lastRow = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row
    If lastRow >= 2 Then
        ws.Range("A2:M" & lastRow).ClearContents
        Dim shp As Shape
        For Each shp In ws.Shapes
            If shp.Type = msoPicture Or shp.Type = msoLinkedPicture Then
                shp.Delete
            End If
        Next shp
    End If

    lastRow = srcWs.Cells(srcWs.Rows.Count, 1).End(xlUp).Row
    lastCol = srcWs.Cells(1, srcWs.Columns.Count).End(xlToLeft).Column
    If lastCol > 13 Then lastCol = 13

    For i = 2 To lastRow
        For j = 1 To lastCol
            ws.Cells(i, j).Value = srcWs.Cells(i, j).Value
        Next j
    Next i

    srcWb.Close False

    Application.ScreenUpdating = True
    Application.DisplayAlerts = True

    MsgBox "数据导入完成！共导入 " & (lastRow - 1) & " 条记录。" & vbCrLf & vbCrLf & _
           "现在可以点击""插入款式图""按钮来插入图片。", _
           vbInformation, "导入成功"
End Sub

Sub 插入款式图()
    Dim ws As Worksheet
    Dim picFolder As String
    Dim lastRow As Long
    Dim styleCol As Long, imageCol As Long
    Dim i As Long, styleNo As String
    Dim pic As Shape
    Dim imgCount As Long
    Dim notFound As String
    Dim extensions As Variant
    Dim ext As Variant
    Dim filePath As String
    Dim found As Boolean
    Dim j As Long

    Set ws = ActiveSheet

    With Application.FileDialog(msoFileDialogFolderPicker)
        .Title = "请选择 picture 文件夹（包含款式图片的文件夹）"
        .InitialFileName = ThisWorkbook.Path & "\picture"
        If .Show = -1 Then
            picFolder = .SelectedItems(1)
        Else
            MsgBox "未选择文件夹，操作已取消", vbExclamation, "提示"
            Exit Sub
        End If
    End With

    styleCol = 0
    imageCol = 0
    For j = 1 To 30
        Select Case Trim(CStr(ws.Cells(1, j).Value))
            Case "款号": styleCol = j
            Case "款式图": imageCol = j
        End Select
    Next j

    If styleCol = 0 Then
        MsgBox "未找到'款号'列", vbExclamation, "错误"
        Exit Sub
    End If
    If imageCol = 0 Then
        MsgBox "未找到'款式图'列", vbExclamation, "错误"
        Exit Sub
    End If

    lastRow = ws.Cells(ws.Rows.Count, styleCol).End(xlUp).Row
    If lastRow < 2 Then
        MsgBox "没有数据行，请先导入数据", vbExclamation, "提示"
        Exit Sub
    End If

    Application.ScreenUpdating = False
    Application.DisplayAlerts = False

    extensions = Array("jpg", "jpeg", "png", "gif", "webp", "bmp", "tif", "tiff")

    Dim imgWidth As Double, imgHeight As Double
    imgWidth = 56.69
    imgHeight = 28.35

    imgCount = 0
    notFound = ""

    For i = 2 To lastRow
        styleNo = Trim(CStr(ws.Cells(i, styleCol).Value))
        If styleNo <> "" Then
            found = False
            For Each ext In extensions
                filePath = picFolder & "\" & styleNo & "." & ext
                If Dir(filePath, vbNormal) <> "" Then
                    found = True
                    Exit For
                End If
            Next ext

            If found Then
                DeleteShapesInCell ws, i, imageCol
                Set pic = ws.Shapes.AddPicture( _
                    Filename:=filePath, _
                    LinkToFile:=msoFalse, _
                    SaveWithDocument:=msoTrue, _
                    Left:=ws.Cells(i, imageCol).Left + 1, _
                    Top:=ws.Cells(i, imageCol).Top + 1, _
                    Width:=imgWidth, _
                    Height:=imgHeight)
                If ws.Rows(i).RowHeight < 32 Then
                    ws.Rows(i).RowHeight = 32
                End If
                imgCount = imgCount + 1
            Else
                If notFound = "" Then
                    notFound = styleNo
                Else
                    notFound = notFound & vbCrLf & styleNo
                End If
            End If
        End If
    Next i

    Application.ScreenUpdating = True
    Application.DisplayAlerts = True

    Dim msg As String
    msg = "图片插入完成！" & vbCrLf & vbCrLf
    msg = msg & "成功插入: " & imgCount & " 张图片" & vbCrLf
    If notFound <> "" Then
        Dim missingCount As Long
        missingCount = UBound(Split(notFound, vbCrLf)) + 1
        msg = msg & "未找到图片: " & missingCount & " 个款号"
        If missingCount <= 20 Then
            msg = msg & vbCrLf & vbCrLf & "未找到图片的款号:" & vbCrLf & notFound
        End If
    End If
    MsgBox msg, vbInformation, "插入结果"
End Sub

Sub 清除款式图()
    Dim ws As Worksheet
    Dim shp As Shape
    Dim count As Long

    Set ws = ActiveSheet
    count = 0

    Application.ScreenUpdating = False

    For Each shp In ws.Shapes
        If shp.Type = msoPicture Or shp.Type = msoLinkedPicture Then
            shp.Delete
            count = count + 1
        End If
    Next shp

    Application.ScreenUpdating = True

    If count > 0 Then
        MsgBox "已清除 " & count & " 张款式图", vbInformation, "清除完成"
    Else
        MsgBox "当前工作表没有款式图", vbExclamation, "提示"
    End If
End Sub

Private Sub DeleteShapesInCell(ws As Worksheet, rowNum As Long, colNum As Long)
    Dim shp As Shape
    Dim cellLeft As Double, cellTop As Double
    Dim cellRight As Double, cellBottom As Double

    cellLeft = ws.Cells(rowNum, colNum).Left
    cellTop = ws.Cells(rowNum, colNum).Top
    cellRight = cellLeft + ws.Cells(rowNum, colNum).Width
    cellBottom = cellTop + ws.Cells(rowNum, colNum).Height

    For Each shp In ws.Shapes
        If shp.Type = msoPicture Or shp.Type = msoLinkedPicture Then
            If shp.Left >= cellLeft And shp.Left <= cellRight And _
               shp.Top >= cellTop And shp.Top <= cellBottom Then
                shp.Delete
            End If
        End If
    Next shp
End Sub
