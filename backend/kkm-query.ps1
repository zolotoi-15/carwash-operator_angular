# backend/kkm-query.ps1
# Query SHTRIH-M KKM driver via COM object AddIn.DrvFR.
# Called from kkm-bridge.js through child_process.
# NOTE: ASCII only. Do not add non-ASCII text to avoid encoding issues.

param(
    [string]$Action = 'status',
    [int]$ComNumber = 1,
    [int]$BaudRate = 115200,
    [string]$ReceiptJson = ''
)

$ErrorActionPreference = 'Stop'

function Write-JsonResult {
    param($obj)
    $obj | ConvertTo-Json -Compress -Depth 10
}

try {
    $device = New-Object -ComObject 'AddIn.DrvFR'

    $device.ComNumber = $ComNumber
    $device.BaudRate  = $BaudRate
    $device.Timeout   = 5000

    $device.OpenPort()

    try {
        switch ($Action) {

            'status' {
                $device.GetECRStatus()
                $resultCode = [int]$device.ResultCode
                $connected  = ($resultCode -eq 0)

                if (-not $connected) {
                    Write-JsonResult @{
                        ready        = $false
                        connected    = $false
                        paper        = $false
                        kkNumber     = ''
                        shiftNumber  = 0
                        cashierName  = ''
                        driverOnline = $true
                        errors       = @("ResultCode=$resultCode")
                    }
                    return
                }

                Write-JsonResult @{
                    ready        = $true
                    connected    = $true
                    paper        = ([int]$device.PaperPresent -eq 1)
                    kkNumber     = [string]$device.SerialNumber
                    shiftNumber  = [int]$device.ShiftNumber
                    cashierName  = 'Operator'
                    driverOnline = $true
                    errors       = @()
                }
            }

            'open-shift' {
                if ($device.PSObject.Methods['OpenSession']) {
                    $device.OpenSession()
                } else {
                    $device.GetECRStatus()
                }
                Write-JsonResult @{ ok = $true; message = 'Shift opened' }
            }

            'x-report' {
                if ($device.PSObject.Methods['PrintXReport']) {
                    $device.PrintXReport()
                } elseif ($device.PSObject.Methods['XReport']) {
                    $device.XReport()
                } else {
                    throw 'X-Report method not found in driver'
                }
                Write-JsonResult @{ ok = $true; message = 'X-Report done' }
            }

            'z-report' {
                if ($device.PSObject.Methods['PrintZReport']) {
                    $device.PrintZReport()
                } elseif ($device.PSObject.Methods['ZReport']) {
                    $device.ZReport()
                } elseif ($device.PSObject.Methods['CloseSession']) {
                    $device.CloseSession()
                } else {
                    throw 'Z-Report method not found in driver'
                }
                Write-JsonResult @{ ok = $true; message = 'Z-Report done' }
            }

            'print' {
                if (-not $ReceiptJson) { throw 'Receipt JSON is empty' }
                $receipt = $ReceiptJson | ConvertFrom-Json
                $items = @($receipt.items)
                if ($items.Count -eq 0) { throw 'Receipt items list is empty' }

                $device.OpenCheck()

                foreach ($it in $items) {
                    $name = [string]$it.name
                    if ($name.Length -gt 40) { $name = $name.Substring(0, 40) }
                    $cost = [double]$it.cost
                    $sum  = [math]::Round($cost, 2)

                    $device.StringForPrinting = $name
                    $device.Price             = $sum
                    $device.Quantity          = 1

                    if ($device.PSObject.Methods['Sale']) {
                        $device.Sale()
                    } elseif ($device.PSObject.Methods['Registration']) {
                        $device.Registration()
                    } else {
                        throw 'Sale/Registration method not found'
                    }
                }

                $total = ($items | ForEach-Object { [double]$_.cost } | Measure-Object -Sum).Sum
                $device.Summ1 = [math]::Round($total, 2)

                if ($device.PSObject.Methods['CloseCheck']) {
                    $device.CloseCheck()
                } elseif ($device.PSObject.Methods['CloseReceipt']) {
                    $device.CloseReceipt()
                } else {
                    throw 'CloseCheck method not found'
                }

                Write-JsonResult @{
                    ok      = $true
                    message = "Receipt $([math]::Round($total,2)) RUR printed"
                }
            }

            default { throw "Unknown action: $Action" }
        }
    }
    finally {
        try { $device.ClosePort() } catch {}
    }
}
catch {
    Write-JsonResult @{
        ready        = $false
        connected    = $false
        paper        = $false
        kkNumber     = ''
        shiftNumber  = 0
        cashierName  = ''
        driverOnline = $false
        errors       = @($_.Exception.Message)
    }
}