# เปิด Clip360 ให้เองทุกครั้งที่ล็อกอินเข้า Windows
#
# ใช้กับเครื่องที่เปิดเป็นบริการให้คนอื่นเข้าผ่านโดเมน — รีสตาร์ตเครื่องแล้วเว็บ
# กลับมาเองโดยไม่ต้องมีคนไปดับเบิลคลิก
#
#   เปิดใช้:  powershell -ExecutionPolicy Bypass -File scripts\autostart-windows.ps1
#   ยกเลิก:   powershell -ExecutionPolicy Bypass -File scripts\autostart-windows.ps1 -Remove
#
# ไม่ต้องใช้สิทธิ์ผู้ดูแลระบบ เพราะสร้างงานในบัญชีของผู้ใช้เอง

param([switch]$Remove)

$ErrorActionPreference = "Stop"
$taskName = "Clip360 Local"
# ชื่องานก่อนเปลี่ยนแบรนด์ เครื่องที่ตั้งไว้แต่เดิมยังมีงานชื่อนี้ค้างอยู่
$legacyTaskName = "ClipPang Local"
$root = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $root "เริ่มโปรแกรม.bat"

# ล้างงานชื่อเดิมทิ้งเสมอ ทั้งตอนตั้งและตอนยกเลิก ไม่งั้นจะเหลืองานสองตัวชี้ไปที่
# ตัวเปิดเดียวกัน แล้วโปรแกรมจะถูกสั่งเปิดซ้อนกันทุกครั้งที่ล็อกอิน
function Remove-LegacyTask {
  if (Get-ScheduledTask -TaskName $legacyTaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $legacyTaskName -Confirm:$false
    Write-Host "ลบงานชื่อเดิม '$legacyTaskName' ทิ้งแล้ว"
  }
}

if ($Remove) {
  $found = $false
  if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    $found = $true
  }
  if (Get-ScheduledTask -TaskName $legacyTaskName -ErrorAction SilentlyContinue) { $found = $true }
  Remove-LegacyTask
  if ($found) {
    Write-Host "ยกเลิกการเปิดอัตโนมัติแล้ว"
  } else {
    Write-Host "ยังไม่ได้ตั้งการเปิดอัตโนมัติไว้"
  }
  return
}

Remove-LegacyTask

if (-not (Test-Path $launcher)) { throw "ไม่พบไฟล์ $launcher" }

# ตัวเปิดโปรแกรมดูแลการสตาร์ตใหม่เมื่อโปรเซสล้มอยู่แล้ว ส่วน RestartCount ตรงนี้
# ไว้เผื่อกรณีที่ตัวเปิดเองก็ตาย เช่นหน้าต่างถูกปิดทิ้ง
$action   = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$launcher`"" -WorkingDirectory $root
$trigger  = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null

Write-Host "ตั้งให้เปิด Clip360 อัตโนมัติเมื่อล็อกอินแล้ว"
Write-Host "  งานชื่อ: $taskName"
Write-Host "  สั่งเปิดเดี๋ยวนี้: Start-ScheduledTask -TaskName '$taskName'"
Write-Host "  ยกเลิก: powershell -ExecutionPolicy Bypass -File scripts\autostart-windows.ps1 -Remove"
