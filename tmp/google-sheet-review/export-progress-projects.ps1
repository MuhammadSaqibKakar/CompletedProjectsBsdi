param(
  [string]$WorkbookPath = ".\tmp\google-sheet-review\bsdi-google-sheet.xlsx",
  [double]$ThresholdPercent = 80,
  [string]$OutDir = ".\tmp\google-sheet-review"
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

function Format-Text($value) {
  if ($null -eq $value) { return '' }
  $text = ($value.ToString() -replace '\s+', ' ').Trim()
  $n = To-Number $text
  if ($null -ne $n -and $n -ge 30000 -and $n -le 70000 -and $text -match '^\d+(\.\d+)?$') {
    return ([datetime]'1899-12-30').AddDays([int][math]::Floor($n)).ToString('dd MMM yyyy')
  }
  return $text
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

New-Item -ItemType Directory -Path $OutDir -Force | Out-Null

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

  $projects = @()
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

      $progressPercent = if ($null -ne $progressCol) { To-ProgressPercent $row.Cells[$progressCol] } else { $null }
      if ($null -eq $progressPercent -or $progressPercent -lt $ThresholdPercent) { continue }

      $projects += [pscustomobject]@{
        District = $sheetDisplay[$sheetName]
        Sheet = $sheetName
        Row = $row.Row
        Phase = $phase
        Serial = Format-Text $row.Cells[0]
        Category = Format-Text $row.Cells[1]
        Title = Format-Text $row.Cells[2]
        CostMn = Format-Text $row.Cells[3]
        ApprovedPayment = Format-Text $row.Cells[4]
        VendorPayment = Format-Text $row.Cells[5]
        ApprovedPayPercent = Format-Text $row.Cells[6]
        ExecutingAgency = Format-Text $row.Cells[7]
        TSE = Format-Text $row.Cells[8]
        NITStatus = Format-Text $row.Cells[9]
        NITOpening = Format-Text $row.Cells[10]
        TechBid = Format-Text $row.Cells[11]
        FinBid = Format-Text $row.Cells[12]
        WorkOrderDate = Format-Text $row.Cells[13]
        WorkStartedDate = Format-Text $row.Cells[14]
        ProgressPercent = $progressPercent
        Remarks = Format-Text $row.Cells[16]
        Contractor = Format-Text $row.Cells[17]
        XEN = Format-Text $row.Cells[18]
        Contact = Format-Text $row.Cells[19]
        GPS = Format-Text $row.Cells[20]
        VisitStatus = Format-Text $row.Cells[21]
      }
    }
  }

  $summary = foreach ($district in ($sheetDisplay.Values | Sort-Object -Unique)) {
    $districtProjects = @($projects | Where-Object { $_.District -eq $district })
    $phase1 = @($districtProjects | Where-Object { $_.Phase -eq 'Phase 1' }).Count
    $phase2 = @($districtProjects | Where-Object { $_.Phase -eq 'Phase 2' }).Count
    [pscustomobject]@{
      District = $district
      Phase1 = $phase1
      Phase2 = $phase2
      Total = $phase1 + $phase2
    }
  }

  $csvPath = Join-Path $OutDir 'progress-80-plus-projects.csv'
  $jsonPath = Join-Path $OutDir 'progress-80-plus-projects.json'
  $summaryPath = Join-Path $OutDir 'progress-80-plus-summary.csv'
  $reportPath = Join-Path $OutDir 'progress-80-plus-report.md'

  $projects |
    Sort-Object District, Phase, {[double]$_.Serial}, Row |
    Export-Csv -NoTypeInformation -Encoding UTF8 $csvPath
  $projects |
    Sort-Object District, Phase, {[double]$_.Serial}, Row |
    ConvertTo-Json -Depth 5 |
    Set-Content -Encoding UTF8 $jsonPath
  $summary |
    Sort-Object District |
    Export-Csv -NoTypeInformation -Encoding UTF8 $summaryPath

  $phase1Total = ($projects | Where-Object { $_.Phase -eq 'Phase 1' }).Count
  $phase2Total = ($projects | Where-Object { $_.Phase -eq 'Phase 2' }).Count
  $allTotal = $projects.Count

  $lines = @()
  $lines += "# BSDI Projects At Least $ThresholdPercent Percent Complete"
  $lines += ""
  $lines += "- Phase 1: $phase1Total"
  $lines += "- Phase 2: $phase2Total"
  $lines += "- Total: $allTotal"
  $lines += ""
  $lines += "## District Summary"
  $lines += ""
  $lines += "| District | Phase 1 | Phase 2 | Total |"
  $lines += "|---|---:|---:|---:|"
  foreach ($item in ($summary | Sort-Object District)) {
    $lines += "| $($item.District) | $($item.Phase1) | $($item.Phase2) | $($item.Total) |"
  }
  $lines += ""
  $lines += "## Full Project List"
  $lines += ""
  $lines += "| District | Phase | Progress | Category | Title | Cost Mn |"
  $lines += "|---|---|---:|---|---|---:|"
  foreach ($project in ($projects | Sort-Object District, Phase, {[double]$_.Serial}, Row)) {
    $title = $project.Title -replace '\|', '/'
    $category = $project.Category -replace '\|', '/'
    $lines += "| $($project.District) | $($project.Phase) | $($project.ProgressPercent)% | $category | $title | $($project.CostMn) |"
  }
  $lines | Set-Content -Encoding UTF8 $reportPath

  $summary | Sort-Object District | Format-Table -AutoSize
  "TOTAL_PHASE_1=$phase1Total"
  "TOTAL_PHASE_2=$phase2Total"
  "TOTAL_ALL=$allTotal"
  "PROJECTS_CSV=$csvPath"
  "PROJECTS_JSON=$jsonPath"
  "SUMMARY_CSV=$summaryPath"
  "REPORT_MD=$reportPath"
} finally {
  $zip.Dispose()
}
