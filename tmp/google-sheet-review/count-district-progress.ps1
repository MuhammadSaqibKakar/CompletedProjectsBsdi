param(
  [string]$WorkbookPath = ".\tmp\google-sheet-review\bsdi-google-sheet.xlsx"
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

function To-Num($value) {
  if ($null -eq $value -or $value -eq '') { return $null }
  $s = ($value.ToString() -replace '%', '' -replace ',', '').Trim()
  $n = 0.0
  if ([double]::TryParse($s, [ref]$n)) { return $n }
  return $null
}

function Is-CompleteProgress($value) {
  $n = To-Num $value
  if ($null -eq $n) { return $false }
  return ($n -ge 1) -or ($n -ge 100)
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

  $results = @()
  foreach ($sheetName in $sheetDisplay.Keys) {
    $rows = Get-SheetRows $sheetName
    $progressCol = $null
    foreach ($row in ($rows | Where-Object { $_.Row -le 6 })) {
      foreach ($key in $row.Cells.Keys) {
        if (($row.Cells[$key] -replace '\s+', ' ') -match '^% Progress$') {
          $progressCol = [int]$key
        }
      }
    }

    $phase = ''
    $phase1Rows = 0
    $phase2Rows = 0
    $phase1Done = 0
    $phase2Done = 0

    foreach ($row in $rows) {
      $rowText = ($row.Cells.Values -join ' ')
      if ($rowText -match 'PHASE\s*[- ]?\s*1|PHASE\s*[- ]?\s*I\b') {
        $phase = 'Phase 1'
        continue
      }
      if ($rowText -match 'PHASE\s*[- ]?\s*2|PHASE\s*[- ]?\s*II\b') {
        $phase = 'Phase 2'
        continue
      }
      if (-not (Is-ProjectRow $row.Cells)) { continue }

      $isDone = $null -ne $progressCol -and (Is-CompleteProgress $row.Cells[$progressCol])
      if ($phase -eq 'Phase 1') {
        $phase1Rows++
        if ($isDone) { $phase1Done++ }
      } elseif ($phase -eq 'Phase 2') {
        $phase2Rows++
        if ($isDone) { $phase2Done++ }
      }
    }

    $results += [pscustomobject]@{
      District = $sheetDisplay[$sheetName]
      Phase1Completed = $phase1Done
      Phase2Completed = $phase2Done
      TotalCompleted = $phase1Done + $phase2Done
      Phase1Rows = $phase1Rows
      Phase2Rows = $phase2Rows
    }
  }

  $results | Sort-Object District | Format-Table -AutoSize
  $phase1Total = ($results | Measure-Object Phase1Completed -Sum).Sum
  $phase2Total = ($results | Measure-Object Phase2Completed -Sum).Sum
  $allTotal = ($results | Measure-Object TotalCompleted -Sum).Sum
  "TOTAL_PHASE_1_COMPLETED=$phase1Total"
  "TOTAL_PHASE_2_COMPLETED=$phase2Total"
  "TOTAL_COMPLETED=$allTotal"
} finally {
  $zip.Dispose()
}
