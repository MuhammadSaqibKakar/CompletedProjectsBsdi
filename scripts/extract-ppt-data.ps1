param(
  [string]$PptxPath = "..\Completed_BSDI-14-03-2026.pptx",
  [string]$OutDir = ".\public"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem

$resolvedPptx = Resolve-Path $PptxPath
$resolvedOut = Resolve-Path $OutDir
$dataDir = Join-Path $resolvedOut "data"
$mediaDir = Join-Path $resolvedOut "media"
$databaseDir = Join-Path $resolvedOut "database"
$databaseMediaDir = Join-Path $databaseDir "media"
New-Item -ItemType Directory -Force -Path $dataDir, $mediaDir, $databaseDir, $databaseMediaDir | Out-Null

function Read-ZipEntryText {
  param($Zip, [string]$Name)
  $entry = $Zip.GetEntry($Name)
  if (-not $entry) { return $null }
  $reader = [IO.StreamReader]::new($entry.Open())
  try { return $reader.ReadToEnd() } finally { $reader.Close() }
}

function Clean-Text {
  param([string]$Value)
  if (-not $Value) { return "" }
  return (($Value -replace "\s+", " ").Trim())
}

function To-Slug {
  param([string]$Value)
  $slug = (Clean-Text $Value).ToLowerInvariant()
  $slug = $slug -replace "[^a-z0-9]+", "-"
  $slug = $slug.Trim("-")
  if (-not $slug) { return "item" }
  return $slug
}

function To-LimitedSlug {
  param([string]$Value, [int]$MaxLength = 58)
  $slug = To-Slug $Value
  if ($slug.Length -le $MaxLength) { return $slug }
  return $slug.Substring(0, $MaxLength).Trim("-")
}

function New-ProjectId {
  param([string]$Division, [string]$District, [int]$Slide, [string]$Title)
  $divisionPart = To-LimitedSlug $Division 22
  $districtPart = To-LimitedSlug $District 22
  $titlePart = To-LimitedSlug $Title 42
  return "p1-$divisionPart-$districtPart-s$($Slide.ToString('000'))-$titlePart"
}

function New-ProjectDescription {
  param([string]$Title, [string]$District, [string]$Division, [string]$Category)
  $parts = @()
  if ($Category) { $parts += $Category }
  if ($District) { $parts += "in $District" }
  if ($Division) { $parts += "under $Division" }
  if (-not $parts.Count) { return "" }
  return "$(Clean-Text $Title) is a completed $($parts -join ' ') record."
}

function Decode-Target {
  param([string]$Target)
  if (-not $Target -or $Target -eq "NULL") { return "" }
  try { return [System.Uri]::UnescapeDataString($Target) } catch { return $Target }
}

function Title-From-Target {
  param([string]$Target)
  $decoded = Decode-Target $Target
  if (-not $decoded) { return "" }
  $leaf = ($decoded -replace "\\", "/").Split("/")[-1]
  $leaf = Clean-Text ($leaf -replace "\.[a-zA-Z0-9]{2,5}$", "")
  if ($leaf -match "^(NULL|New folder(?: \(\d+\))?)$") { return "" }
  return $leaf
}

function District-From-Target {
  param([string]$Target)
  $decoded = Decode-Target $Target
  $match = [regex]::Match($decoded, "(?i)Districts/([^/]+)/")
  if ($match.Success) { return Clean-Text $match.Groups[1].Value }
  return ""
}

function Get-TextTokens {
  param($Zip, [int]$Slide)
  $xml = Read-ZipEntryText $Zip "ppt/slides/slide$Slide.xml"
  if (-not $xml) { return @() }
  $doc = [xml]$xml
  $nsmgr = [System.Xml.XmlNamespaceManager]::new($doc.NameTable)
  $nsmgr.AddNamespace("a", "http://schemas.openxmlformats.org/drawingml/2006/main")
  return @(
    $doc.SelectNodes("//a:t", $nsmgr) |
      ForEach-Object { Clean-Text $_.'#text' } |
      Where-Object { $_ }
  )
}

function Get-Relationships {
  param($Zip, [int]$Slide)
  $xml = Read-ZipEntryText $Zip "ppt/slides/_rels/slide$Slide.xml.rels"
  if (-not $xml) { return @() }
  $doc = [xml]$xml
  return @($doc.Relationships.Relationship)
}

function Find-TokenIndex {
  param([array]$Tokens, [array]$Labels)
  $best = -1
  for ($i = 0; $i -lt $Tokens.Count; $i++) {
    foreach ($label in $Labels) {
      if ($Tokens[$i] -ieq $label) {
        if ($best -eq -1 -or $i -lt $best) { $best = $i }
      }
    }
  }
  return $best
}

function Range-After {
  param([array]$Tokens, [array]$StartLabels, [array]$StopLabels)
  $start = Find-TokenIndex $Tokens $StartLabels
  if ($start -lt 0) { return "" }
  if ($Tokens[$start] -ieq "Focal" -and (($start + 1) -lt $Tokens.Count) -and $Tokens[$start + 1] -ieq "Offr") {
    $start++
  }
  $stop = $Tokens.Count
  for ($i = $start + 1; $i -lt $Tokens.Count; $i++) {
    foreach ($label in $StopLabels) {
      if ($Tokens[$i] -ieq $label) {
        $stop = $i
        break
      }
    }
    if ($stop -ne $Tokens.Count) { break }
  }
  if ($stop -le ($start + 1)) { return "" }
  $parts = $Tokens[($start + 1)..($stop - 1)] | Where-Object {
    $_ -and $_ -notmatch "^(Fmn|Offr|/)$"
  }
  return Clean-Text ($parts -join " ")
}

function Normalize-Cost {
  param([string]$Cost)
  $value = Clean-Text $Cost
  if ($value -match '^\d(?: \d)+$') { return ($value -replace ' ', '') }
  if ($value -match '^(\d+) \. (\d+)$') { return "$($Matches[1]).$($Matches[2])" }
  return $value
}

function Title-From-Tokens {
  param([array]$Tokens)
  if (-not $Tokens.Count) { return "" }
  $fieldLabels = @("AOR Unit /Wing /", "Cost (PC-1)", "Duration", "NIT (Opening Date)", "Contr", "Work O", "Focal", "Progress", "XEN", "SCOPE")
  $aor = Find-TokenIndex $Tokens @("AOR Unit /Wing /")
  $loc = Find-TokenIndex $Tokens @("Loc on Map")
  if ($loc -ge 0 -and $aor -gt ($loc + 1)) {
    return Clean-Text (($Tokens[($loc + 1)..($aor - 1)] | Where-Object { $_ -and $_ -ne "Loc on Map" }) -join " ")
  }
  $firstField = Find-TokenIndex $Tokens $fieldLabels
  if ($firstField -gt 0) {
    return Clean-Text (($Tokens[0..($firstField - 1)] | Where-Object { $_ -and $_ -ne "Loc on Map" }) -join " ")
  }
  return Clean-Text (($Tokens | Select-Object -First 8) -join " ")
}

function Category-For {
  param([string]$Title)
  $t = $Title.ToLowerInvariant()
  if ($t -match "solar|street light") { return "Solar & Energy" }
  if ($t -match "\bwss\b|water supply|water bore|boring|bore") { return "Water Supply" }
  if ($t -match "protection|flood|gabion|bund|band|wall") { return "Protection Works" }
  if ($t -match "repair|renov|rehab|up-grad|up grad|replacement") { return "Repair & Rehabilitation" }
  if ($t -match "school|college|class|lab|it hub|education") { return "Education" }
  if ($t -match "hospital|bhu|rhc|dispensar|mch|health") { return "Health" }
  if ($t -match "road|park|shade|hall|facility|construction|const") { return "Civil Works" }
  return "Infrastructure"
}

function Normalize-District {
  param([string]$District)
  $d = Clean-Text $District
  if (-not $d) { return "" }
  $map = @{
    "Qilla%20Abdullah" = "Qilla Abdullah";
    "Dera%20Bugti" = "Dera Bugti";
    "Usta%20Muhammad" = "Usta Muhammad";
    "Naseer Abad" = "Naseerabad";
    "Punjgur" = "Panjgur";
    "Qta" = "Quetta";
    "Gawadar" = "Gwadar";
    "KA" = "Qilla Abdullah"
  }
  if ($map.ContainsKey($d)) { return $map[$d] }
  return $d
}

function Infer-District {
  param([string]$Text)
  $known = @(
    "Awaran", "Barkhan", "Chagai", "Chaman", "Dera Bugti", "Duki", "Gwadar",
    "Harnai", "Hub", "Jaffarabad", "Kachhi", "Kalat", "Kech", "Kharan",
    "Khuzdar", "Kohlu", "Lasbela", "Loralai", "Mastung", "Musa Khel",
    "Naseerabad", "Nushki", "Panjgur", "Pishin", "Qilla Abdullah",
    "Quetta", "Sherani", "Sibi", "Sohbatpur", "Sorab", "Surab",
    "Usta Muhammad", "Washuk", "Zhob", "Ziarat"
  )
  foreach ($name in $known) {
    if ($Text -match "(?i)\b$([regex]::Escape($name))\b") { return $name }
  }
  return ""
}

function Get-MediaForSlide {
  param($Zip, [int]$Slide)
  $rels = Get-Relationships $Zip $Slide
  $items = @()
  foreach ($rel in $rels) {
    $target = [string]$rel.Target
    if (-not $target -or $target -notmatch "\.\./media/") { continue }
    $mediaName = [IO.Path]::GetFileName($target)
    $ext = [IO.Path]::GetExtension($mediaName).ToLowerInvariant()
    if ($ext -notin @(".jpg", ".jpeg", ".png", ".webp", ".mp4", ".m4v")) { continue }
    $entry = $Zip.GetEntry("ppt/media/$mediaName")
    if (-not $entry) { continue }
    $type = if ($ext -in @(".mp4", ".m4v")) { "video" } else { "image" }
    $items += [pscustomobject]@{
      type = $type
      source = "ppt/media/$mediaName"
      src = "/media/$mediaName"
      name = $mediaName
      ext = $ext
      size = [int64]$entry.Length
    }
  }
  $images = @($items | Where-Object { $_.type -eq "image" -and $_.size -gt 12000 } | Sort-Object size -Descending | Select-Object -First 4)
  $videos = @($items | Where-Object { $_.type -eq "video" } | Sort-Object size -Descending | Select-Object -First 1)
  return @($videos + $images)
}

function Copy-ProjectMedia {
  param($Zip, [array]$MediaItems, [string]$DatabaseMediaDir)
  foreach ($media in $MediaItems) {
    $projectDir = Join-Path $DatabaseMediaDir $media.projectId
    New-Item -ItemType Directory -Force -Path $projectDir | Out-Null
    $dest = Join-Path $projectDir $media.fileName
    if (Test-Path $dest) { continue }
    $entry = $Zip.GetEntry($media.source)
    if (-not $entry) { continue }
    $inStream = $entry.Open()
    $outStream = [IO.File]::Create($dest)
    try { $inStream.CopyTo($outStream) } finally { $outStream.Close(); $inStream.Close() }
  }
}

function Copy-Media {
  param($Zip, [array]$MediaItems, [string]$MediaDir)
  foreach ($media in $MediaItems) {
    $dest = Join-Path $MediaDir $media.name
    if (Test-Path $dest) { continue }
    $entry = $Zip.GetEntry($media.source)
    if (-not $entry) { continue }
    $inStream = $entry.Open()
    $outStream = [IO.File]::Create($dest)
    try { $inStream.CopyTo($outStream) } finally { $outStream.Close(); $inStream.Close() }
  }
}

$zip = [System.IO.Compression.ZipFile]::OpenRead($resolvedPptx)
try {
  $presentationXml = Read-ZipEntryText $zip "ppt/presentation.xml"
  $slideIds = @([regex]::Matches($presentationXml, '<p:sldId[^>]*\sid="(\d+)"') | ForEach-Object { $_.Groups[1].Value })
  $idToPosition = @{}
  for ($i = 0; $i -lt $slideIds.Count; $i++) { $idToPosition[$slideIds[$i]] = $i + 1 }

  $sections = @()
  foreach ($match in [regex]::Matches($presentationXml, '<p14:section[^>]*name="([^"]+)"[\s\S]*?</p14:section>')) {
    $name = Clean-Text ([System.Net.WebUtility]::HtmlDecode($match.Groups[1].Value))
    $ids = @([regex]::Matches($match.Value, '<p14:sldId[^>]*\sid="(\d+)"') | ForEach-Object { $_.Groups[1].Value })
    $positions = @($ids | ForEach-Object { if ($idToPosition.ContainsKey($_)) { [int]$idToPosition[$_] } } | Sort-Object)
    if ($positions.Count) {
      $sections += [pscustomobject]@{
        id = To-Slug $name
        name = $name
        startSlide = $positions[0]
        endSlide = $positions[-1]
        slideCount = $positions.Count
      }
    }
  }

  $projects = @()
  $districtNames = @{}
  $mediaToCopy = @()
  $databaseMediaToCopy = @()
  $allMediaRecords = @()
  $usedSlugs = @{}
  $usedProjectIds = @{}
  $currentDistrictByDivision = @{}
  $skipTitles = 'COMPLETED PROJS|SUMMARY COMPLETED PROJS|DIVISION \(|UPDATE -'

  for ($slide = 1; $slide -le $slideIds.Count; $slide++) {
    $tokens = Get-TextTokens $zip $slide
    if (-not $tokens.Count) { continue }

    $rels = Get-Relationships $zip $slide
    $externalTargets = @(
      $rels |
        Where-Object { $_.TargetMode -eq "External" -or ([string]$_.Target -match "^(Districts/|https?://)") } |
        ForEach-Object { Decode-Target ([string]$_.Target) } |
        Where-Object { $_ -and $_ -ne "NULL" }
    )
    $externalTitle = ""
    $district = ""
    foreach ($target in $externalTargets) {
      if (-not $district) { $district = District-From-Target $target }
      if (-not $externalTitle) { $externalTitle = Title-From-Target $target }
    }

    $title = if ($externalTitle) { $externalTitle } else { Title-From-Tokens $tokens }
    $title = Clean-Text $title
    if (-not $title -or $title -match $skipTitles) { continue }

    $hasProjectFields = ($tokens -contains "Cost (PC-1)") -or ($tokens -contains "Progress") -or ($tokens -contains "Contr") -or ($externalTargets.Count -gt 0)
    if (-not $hasProjectFields -or $slide -lt 14) { continue }

    $section = $sections | Where-Object { $_.startSlide -le $slide -and $_.endSlide -ge $slide } | Select-Object -First 1
    $division = if ($section) { $section.name } else { "Completed Projects" }
    $district = Normalize-District $district
    if (-not $district) {
      $district = Infer-District (($title, ($tokens -join " "), ($externalTargets -join " ")) -join " ")
    }
    if (-not $district -and $currentDistrictByDivision.ContainsKey($division)) {
      $district = $currentDistrictByDivision[$division]
    }
    if ($district) {
      $currentDistrictByDivision[$division] = $district
    }
    if ($district) { $districtNames[$district] = $true }

    $baseSlug = To-Slug $title
    $slug = $baseSlug
    $suffix = 2
    while ($usedSlugs.ContainsKey($slug)) {
      $slug = "$baseSlug-$suffix"
      $suffix++
    }
    $usedSlugs[$slug] = $true

    $baseProjectId = New-ProjectId $division $district $slide $title
    $projectId = $baseProjectId
    $projectSuffix = 2
    while ($usedProjectIds.ContainsKey($projectId)) {
      $projectId = "$baseProjectId-$projectSuffix"
      $projectSuffix++
    }
    $usedProjectIds[$projectId] = $true

    $rawMedia = @(Get-MediaForSlide $zip $slide)
    if ($rawMedia.Count) { $mediaToCopy += $rawMedia }
    $media = @()
    $imageIndex = 1
    $videoIndex = 1
    $mediaOrder = 1
    foreach ($raw in $rawMedia) {
      $kind = if ($raw.type -eq "video") { "vid" } else { "img" }
      $kindIndex = if ($raw.type -eq "video") { $videoIndex } else { $imageIndex }
      if ($raw.type -eq "video") { $videoIndex++ } else { $imageIndex++ }
      $mediaId = "$projectId-$kind-$($kindIndex.ToString('00'))"
      $fileName = "$mediaId$($raw.ext)"
      $src = "/database/media/$projectId/$fileName"
      $mediaRecord = [ordered]@{
        id = $mediaId
        projectId = $projectId
        type = $raw.type
        src = $src
        path = "database/media/$projectId/$fileName"
        fileName = $fileName
        originalName = $raw.name
        size = $raw.size
        order = $mediaOrder
        source = $raw.source
      }
      $media += [pscustomobject]$mediaRecord
      $allMediaRecords += [pscustomobject]$mediaRecord
      $databaseMediaToCopy += [pscustomobject]$mediaRecord
      $mediaOrder++
    }

    $progress = Range-After $tokens @("Progress") @("XEN", "Loc on Map", "SCOPE")
    if (-not $progress -and (($tokens -join " ") -match "100\s*%")) { $progress = "100%" }

    $project = [ordered]@{
      id = $projectId
      legacyId = $slug
      phaseId = "phase-1"
      phase = "Phase 1"
      slide = $slide
      title = $title
      description = New-ProjectDescription $title $district $division (Category-For $title)
      divisionId = To-Slug $division
      division = $division
      districtId = To-Slug $district
      district = $district
      category = Category-For $title
      cost = Normalize-Cost (Range-After $tokens @("Cost (PC-1)") @("Duration", "NIT (Opening Date)", "Contr", "Work O", "Focal", "Progress", "XEN", "Loc on Map", "SCOPE"))
      duration = Range-After $tokens @("Duration") @("NIT (Opening Date)", "Contr", "Work O", "Focal", "Progress", "XEN", "Loc on Map", "SCOPE")
      nitDate = Range-After $tokens @("NIT (Opening Date)") @("Contr", "Work O", "Focal", "Progress", "XEN", "Loc on Map", "SCOPE")
      contractor = Range-After $tokens @("Contr") @("Work O", "Focal", "Progress", "XEN", "Loc on Map", "SCOPE")
      workOrder = Range-After $tokens @("Work O") @("Focal", "Progress", "XEN", "Loc on Map", "SCOPE")
      focalOfficer = Range-After $tokens @("Focal") @("Progress", "XEN", "Loc on Map", "SCOPE")
      progress = $progress
      xen = Range-After $tokens @("XEN") @("Loc on Map", "SCOPE")
      scope = Range-After $tokens @("SCOPE") @("Loc on Map")
      driveLink = ""
      videoDriveLink = ""
      sourcePath = if ($externalTargets.Count) { $externalTargets[0] } else { "" }
      searchText = Clean-Text (($tokens + $externalTargets) -join " ")
      mediaIds = @($media | ForEach-Object { $_.id })
      imageIds = @($media | Where-Object { $_.type -eq "image" } | ForEach-Object { $_.id })
      videoIds = @($media | Where-Object { $_.type -eq "video" } | ForEach-Object { $_.id })
      media = @($media | ForEach-Object {
        [ordered]@{
          id = $_.id
          projectId = $_.projectId
          type = $_.type
          src = $_.src
          name = $_.fileName
          originalName = $_.originalName
          size = $_.size
          order = $_.order
        }
      })
    }
    $projects += [pscustomobject]$project
  }

  Copy-Media $zip ($mediaToCopy | Sort-Object name -Unique) $mediaDir
  Copy-ProjectMedia $zip ($databaseMediaToCopy | Sort-Object id -Unique) $databaseMediaDir

  $divisionStats = @(
    $sections |
      Where-Object { $_.name -ne "Completed Projects" } |
      ForEach-Object {
        $name = $_.name
        $items = @($projects | Where-Object { $_.division -eq $name })
        [ordered]@{
          id = $_.id
          name = $name
          startSlide = $_.startSlide
          endSlide = $_.endSlide
          projectCount = $items.Count
          districts = @($items | ForEach-Object { $_.district } | Where-Object { $_ } | Sort-Object -Unique)
        }
      }
  )

  $districtStats = @(
    $districtNames.Keys |
      Sort-Object |
      ForEach-Object {
        $name = $_
        $items = @($projects | Where-Object { $_.district -eq $name })
        [ordered]@{
          id = To-Slug $name
          name = $name
          projectCount = $items.Count
          divisions = @($items | ForEach-Object { $_.division } | Where-Object { $_ } | Sort-Object -Unique)
        }
      }
  )

  $phaseRecords = @(
    [ordered]@{
      id = "phase-1"
      name = "Phase 1"
      status = "completed"
      projectCount = $projects.Count
      projectIds = @($projects | ForEach-Object { $_.id })
    },
    [ordered]@{
      id = "phase-2"
      name = "Phase 2"
      status = "planned"
      projectCount = 0
      projectIds = @()
    },
    [ordered]@{
      id = "phase-3"
      name = "Phase 3"
      status = "planned"
      projectCount = 0
      projectIds = @()
    }
  )

  $dataset = [ordered]@{
    meta = [ordered]@{
      title = "BSDI Completed Projects"
      subtitle = "Completed project archive"
      sourceFile = [IO.Path]::GetFileName($resolvedPptx)
      sourceDate = "14 Mar 2026"
      generatedAt = (Get-Date).ToString("s")
      totalSlides = $slideIds.Count
      deckSummary = [ordered]@{
        districts = $districtStats.Count
        totalProjects = $projects.Count
        inProgress = 0
        completed = $projects.Count
        budgetBn = 13.124
      }
    }
    phases = $phaseRecords
    sections = $sections
    divisions = $divisionStats
    districts = $districtStats
    projects = $projects
    media = @($allMediaRecords | ForEach-Object {
      [ordered]@{
        id = $_.id
        projectId = $_.projectId
        type = $_.type
        src = $_.src
        path = $_.path
        fileName = $_.fileName
        originalName = $_.originalName
        size = $_.size
        order = $_.order
      }
    })
  }

  $jsonPath = Join-Path $dataDir "projects.json"
  $dataset | ConvertTo-Json -Depth 12 | Set-Content -Path $jsonPath -Encoding UTF8

  $db = [ordered]@{
    schemaVersion = 1
    databaseName = "bsdi-completed-projects"
    generatedAt = (Get-Date).ToString("s")
    source = [ordered]@{
      file = [IO.Path]::GetFileName($resolvedPptx)
      date = "14 Mar 2026"
      totalSlides = $slideIds.Count
    }
    totals = [ordered]@{
      projects = $projects.Count
      divisions = $divisionStats.Count
      districts = $districtStats.Count
      media = $allMediaRecords.Count
      images = @($allMediaRecords | Where-Object { $_.type -eq "image" }).Count
      videos = @($allMediaRecords | Where-Object { $_.type -eq "video" }).Count
      budgetBn = 13.124
    }
    phases = $phaseRecords
    divisions = $divisionStats
    districts = $districtStats
    projects = $projects
    media = @($allMediaRecords | ForEach-Object {
      [ordered]@{
        id = $_.id
        projectId = $_.projectId
        type = $_.type
        src = $_.src
        path = $_.path
        fileName = $_.fileName
        originalName = $_.originalName
        size = $_.size
        order = $_.order
      }
    })
  }

  $dbPath = Join-Path $databaseDir "bsdi-db.json"
  $db | ConvertTo-Json -Depth 14 | Set-Content -Path $dbPath -Encoding UTF8

  Write-Host "Wrote $jsonPath"
  Write-Host "Wrote $dbPath"
  Write-Host "Projects: $($projects.Count)"
  Write-Host "Media copied: $(($mediaToCopy | Sort-Object name -Unique).Count)"
  Write-Host "Database media copied: $(($databaseMediaToCopy | Sort-Object id -Unique).Count)"
} finally {
  $zip.Dispose()
}
