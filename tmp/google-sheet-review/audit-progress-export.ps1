param(
  [string]$WorkbookPath = ".\tmp\google-sheet-review\bsdi-google-sheet.xlsx",
  [string]$CsvPath = ".\tmp\google-sheet-review\progress-80-plus-projects.csv",
  [double]$ThresholdPercent = 80
)

Add-Type -AssemblyName System.IO.Compression.FileSystem

function Read-ZipText($zip, [string]$name) {
  $entry = $zip.GetEntry($name)
  if (-not $entry) { return $null }
  $reader = New-Object System.IO.StreamReader($entry.Open())
  try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
}

function Col-To-Index([string]$ref) {
  $letters = ([regex]::Match($ref, '^[A-Z]+')).Value
  $n = 0
  foreach ($ch in $letters.ToCharArray()) {
    $n = $n * 26 + ([int][char]$ch - [int][char]'A' + 1)
  }
  return $n - 1
}

function To-Number($value) {
  if ($null -eq $value -or $value -eq '') { return $null }
  $s = ($value.ToString() -replace '%', '' -replace ',', '').Trim()
  $n = 0.0
  if ([double]::TryParse($s, [ref]$n)) { return $n }
  return $null
}

function To-ProgressPercent($value) {
  $n = To-Number $value
  if ($null -eq $n) { return $null }
  if ($n -le 1) { return [math]::Round($n * 100, 2) }
  return [math]::Round($n, 2)
}

function Is-ProjectRow($cells) {
  return $cells.ContainsKey(0) -and
    (($cells[0].ToString()) -match '^\d+(\.\d+)?$') -and
    $cells.ContainsKey(2) -and
    ($cells[2].ToString().Trim() -ne '')
}

$sheetDisplay = [ordered]@{
  'Awaran'          = 'Awaran'
  'Barkhan'         = 'Barkhan'
  'Chaghi'          = 'Chaghai'
  'Chaman'          = 'Chaman'
  'Dera Bughti'     = 'Dera Bugti'
  'Duki'            = 'Duki'
  'Gawadar'         = 'Gwadar'
  'Harnai'          = 'Harnai'
  'Hub'             = 'Hub'
  'Jaffarabad'      = 'Jaffarabad'
  'Jhal Magsi'      = 'Jhal Magsi'
  'Kachhi'          = 'Kachhi'
  'Kalat'           = 'Kalat'
  'Kech'            = 'Kech'
  'Kharan'          = 'Kharan'
  'Khuzdar'         = 'Khuzdar'
  'Killa Abdullah'  = 'Killa Abdullah'
  'QS'              = 'Killa Saifullah'
  'Kohlu'           = 'Kohlu'
  'Lasbela'         = 'Lasbela'
  'LLI'             = 'Loralai'
  'Mastung'         = 'Mastung'
  'Musa Khel'       = 'Musa Khel'
  'Naseerabad'      = 'Naseerabad'
  'Nushki'          = 'Noushki'
  'Panjgur'         = 'Panjgur'
  'Pishin'          = 'Pishin'
  'Quetta'          = 'Quetta'
  'Sherani'         = 'Sherani'
  'Sibi'            = 'Sibi'
  'Sohbatpur'       = 'Sohbatpur'
  'Surab'           = 'Surab'
  'Usta Muhammad'   = 'Usta Muhammad'
  'Washuk'          = 'Washuk'
  'Zhob'            = 'Zhob'
  'Ziarat'          = 'Ziarat'
}

$zip = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path $WorkbookPath))
try {
  $shared = @()
  $sharedText = Read-ZipText $zip 'xl/sharedStrings.xml'
  if ($sharedText) {
    [xml]$sharedXml = $sharedText
    $sharedNs = New-Object System.Xml.XmlNamespaceManager($sharedXml.NameTable)
    $sharedNs.AddNamespace('x', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')
    foreach ($si in $sharedXml.SelectNodes('//x:si', $sharedNs)) {
      $shared += (($si.SelectNodes('.//x:t', $sharedNs) | ForEach-Object { $_.InnerText }) -join '')
    }
  }

  [xml]$workbook = Read-ZipText $zip 'xl/workbook.xml'
  [xml]$rels = Read-ZipText $zip 'xl/_rels/workbook.xml.rels'
  $wbNs = New-Object System.Xml.XmlNamespaceManager($workbook.NameTable)
  $wbNs.AddNamespace('x', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')
  $wbNs.AddNamespace('r', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')

  $relMap = @{}
  foreach ($rel in $rels.Relationships.Relationship) {
    $relMap[$rel.Id] = $rel.Target
  }

  $sheetMap = @{}
  foreach ($sheet in $workbook.SelectNodes('//x:sheet', $wbNs)) {
    $rid = $sheet.GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
    $target = $relMap[$rid]
    $sheetMap[$sheet.name] = if ($target.StartsWith('/')) { $target.TrimStart('/') } else { 'xl/' + $target.TrimStart('/') }
  }

  function Get-SheetRows([string]$name) {
    [xml]$xml = Read-ZipText $zip $sheetMap[$name]
    $ns = New-Object System.Xml.XmlNamespaceManager($xml.NameTable)
    $ns.AddNamespace('x', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')
    $rows = @()
    foreach ($row in $xml.SelectNodes('//x:sheetData/x:row', $ns)) {
      $cells = @{}
      foreach ($c in $row.SelectNodes('x:c', $ns)) {
        $idx = Col-To-Index $c.r
        $value = ''
        $v = $c.SelectSingleNode('x:v', $ns)
        if ($c.t -eq 's' -and $v) {
          $value = $shared[[int]$v.InnerText]
        } elseif ($c.t -eq 'inlineStr') {
          $value = ($c.SelectNodes('.//x:t', $ns) | ForEach-Object { $_.InnerText }) -join ''
        } elseif ($v) {
          $value = $v.InnerText
        }
        $cells[$idx] = ($value -replace '\s+', ' ').Trim()
      }
      $rows += [pscustomobject]@{ Row = [int]$row.r; Cells = $cells }
    }
    return $rows
  }

  $expectedSheets = @($sheetDisplay.Keys)
  $missingSheets = @($expectedSheets | Where-Object { -not $sheetMap.ContainsKey($_) })
  $missingProgress = @()
  $workbookRecords = @()
  $projectRowCount = 0
  $blankProgressCount = 0

  foreach ($sheetName in $expectedSheets) {
    if (-not $sheetMap.ContainsKey($sheetName)) { continue }
    $rows = Get-SheetRows $sheetName
    $progressCol = $null
    foreach ($row in ($rows | Where-Object { $_.Row -le 6 })) {
      foreach ($key in $row.Cells.Keys) {
        if (($row.Cells[$key] -replace '\s+', ' ') -match '^% Progress$') {
          $progressCol = [int]$key
        }
      }
    }
    if ($null -eq $progressCol) { $missingProgress += $sheetName }

    $phase = 'Phase 1'
    foreach ($row in $rows) {
      $rowText = ($row.Cells.Values -join ' ')
      if ($rowText -match '\bPH(?:ASE)?\s*[- ]?\s*(?:2|II)\b') {
        $phase = 'Phase 2'
        continue
      }
      if ($rowText -match '\bPH(?:ASE)?\s*[- ]?\s*(?:1|I)\b') {
        $phase = 'Phase 1'
        continue
      }
      if (-not (Is-ProjectRow $row.Cells)) { continue }

      $projectRowCount++
      $progressPercent = if ($null -ne $progressCol) { To-ProgressPercent $row.Cells[$progressCol] } else { $null }
      if ($null -eq $progressPercent) { $blankProgressCount++ }
      if ($null -ne $progressPercent -and $progressPercent -ge $ThresholdPercent) {
        $workbookRecords += [pscustomobject]@{
          Key = "$sheetName::$($row.Row)"
          Sheet = $sheetName
          Row = $row.Row
          District = $sheetDisplay[$sheetName]
          Phase = $phase
          ProgressPercent = $progressPercent
          Title = $row.Cells[2]
        }
      }
    }
  }

  $csv = @(Import-Csv $CsvPath)
  $csvKeys = @{}
  foreach ($row in $csv) { $csvKeys["$($row.Sheet)::$($row.Row)"] = $row }
  $workbookKeys = @{}
  foreach ($row in $workbookRecords) { $workbookKeys[$row.Key] = $row }

  $missed = @($workbookRecords | Where-Object { -not $csvKeys.ContainsKey($_.Key) })
  $extra = @($csv | Where-Object { -not $workbookKeys.ContainsKey("$($_.Sheet)::$($_.Row)") })
  $duplicateKeys = @(
    $csv |
      Group-Object Sheet, Row |
      Where-Object { $_.Count -gt 1 } |
      ForEach-Object { $_.Name }
  )

  $phase1 = @($csv | Where-Object { $_.Phase -eq 'Phase 1' }).Count
  $phase2 = @($csv | Where-Object { $_.Phase -eq 'Phase 2' }).Count

  "EXPECTED_DISTRICT_SHEETS=$($expectedSheets.Count)"
  "FOUND_DISTRICT_SHEETS=$($expectedSheets.Count - $missingSheets.Count)"
  "MISSING_SHEETS=$($missingSheets -join ', ')"
  "MISSING_PROGRESS_COLUMNS=$($missingProgress -join ', ')"
  "TOTAL_PROJECT_ROWS_SCANNED=$projectRowCount"
  "BLANK_PROGRESS_ROWS=$blankProgressCount"
  "WORKBOOK_80_PLUS_ROWS=$($workbookRecords.Count)"
  "CSV_ROWS=$($csv.Count)"
  "CSV_PHASE_1=$phase1"
  "CSV_PHASE_2=$phase2"
  "MISSED_80_PLUS_ROWS=$($missed.Count)"
  "EXTRA_CSV_ROWS=$($extra.Count)"
  "DUPLICATE_CSV_KEYS=$($duplicateKeys.Count)"

  if ($missed.Count -or $extra.Count -or $duplicateKeys.Count -or $missingSheets.Count -or $missingProgress.Count) {
    if ($missed.Count) {
      "MISSED_SAMPLE:"
      $missed | Select-Object -First 10 District, Phase, ProgressPercent, Sheet, Row, Title | Format-Table -AutoSize
    }
    if ($extra.Count) {
      "EXTRA_SAMPLE:"
      $extra | Select-Object -First 10 District, Phase, ProgressPercent, Sheet, Row, Title | Format-Table -AutoSize
    }
    exit 1
  }

  "AUDIT=PASS"
} finally {
  $zip.Dispose()
}
