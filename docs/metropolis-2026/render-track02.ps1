$ErrorActionPreference = 'Stop'
$deckDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../output/metropolis-2026'))
$deckPath = Join-Path $deckDir '知账-Metropolis-Track02.pptx'
$renderDir = Join-Path $deckDir 'rendered-track02'
New-Item -ItemType Directory -Force $renderDir | Out-Null
$alreadyRunning = @(Get-Process POWERPNT -ErrorAction SilentlyContinue).Count -gt 0
$powerPoint = New-Object -ComObject PowerPoint.Application
$presentation = $null
try {
  $presentation = $powerPoint.Presentations.Open($deckPath, $true, $false, $false)
  $issues = @()
  for ($n = 1; $n -le $presentation.Slides.Count; $n++) {
    $slide = $presentation.Slides.Item($n)
    $slide.Export((Join-Path $renderDir ('slide-{0:D2}.png' -f $n)), 'PNG', 1600, 900)
    foreach ($shape in $slide.Shapes) {
      if ($shape.HasTextFrame -eq -1 -and $shape.TextFrame.HasText -eq -1) {
        $range = $shape.TextFrame.TextRange
        if ($range.BoundHeight -gt ($shape.Height + 3) -or $range.BoundWidth -gt ($shape.Width + 3)) {
          $issues += "Slide ${n}: text bounds exceed box: $($range.Text.Substring(0,[Math]::Min(30,$range.Text.Length)))"
        }
      }
    }
  }
  $presentation.SaveAs((Join-Path $deckDir '知账-Metropolis-Track02.pdf'), 32)
  @{slides=$presentation.Slides.Count; textOverflow=$issues; renderer='Microsoft PowerPoint'; size='1600x900'} | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $deckDir 'validation-track02.json') -Encoding utf8
  Get-Content (Join-Path $deckDir 'validation-track02.json')
} finally {
  if ($null -ne $presentation) { $presentation.Close() }
  if (-not $alreadyRunning) { $powerPoint.Quit() }
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($powerPoint)
}
