using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using DrvFRLib;

namespace KkmProxy
{
  public class Startup
  {
    public void ConfigureServices(IServiceCollection services)
    {
      services.AddControllers();
    }

    public void Configure(IApplicationBuilder app, IWebHostEnvironment env)
    {
      if (env.IsDevelopment())
        app.UseDeveloperExceptionPage();
      app.UseRouting();
      app.UseEndpoints(endpoints => endpoints.MapControllers());
    }
  }

  [ApiController]
  [Route("api/kkm")]
  public class KkmController : ControllerBase
  {
    private const int ComPort = 1;          // 0 = COM1
    private const int BaudRate = 115200;
    private const int Timeout = 1000;
    private const string Password = "30";

    // --------------------- GET /status ---------------------
    [HttpGet("status")]
    public IActionResult GetStatus()
    {
      DrvFR? driver = null;
      var errors = new List<string>();

      try
      {
        driver = new DrvFR();
        dynamic fr = driver;
        ConfigureAndConnect(fr);

        if (CheckResult(fr, out string errMsg))
        {
          errors.Add($"Ошибка подключения: {errMsg}");
          return Ok(new
          {
            ready = false,
            connected = false,
            paper = true,
            kktNumber = (string?)null,
            shiftNumber = (int?)null,
            cashierName = (string?)null,
            receiptOpened = false,
            errors = errors
          });
        }

        fr.GetECRStatus();
        if (CheckResult(fr, out errMsg))
        {
          errors.Add($"Ошибка получения статуса ККМ: {errMsg}");
          return Ok(new
          {
            ready = false,
            connected = false,
            paper = true,
            kktNumber = (string?)null,
            shiftNumber = (int?)null,
            cashierName = (string?)null,
            receiptOpened = false,
            errors = errors
          });
        }

        bool paper = true;
        try { paper = fr.PaperPresent; }
        catch { errors.Add("Не удалось определить наличие бумаги"); }

        string? serialNumber = fr.SerialNumber;
        int shiftNumber = fr.SessionNumber;
        string cashierName = "Оператор";
        bool receiptOpened = fr.ECRMode == 8;

        if (string.IsNullOrEmpty(serialNumber))
          errors.Add("Не удалось получить серийный номер ККТ");

        if (shiftNumber == 0 && !receiptOpened)
          errors.Add("Фискальная смена закрыта. Откройте смену перед продажами.");

        return Ok(new
        {
          ready = true,
          connected = true,
          paper = paper,
          kktNumber = serialNumber ?? "—",
          shiftNumber = shiftNumber,
          cashierName = cashierName,
          receiptOpened = receiptOpened,
          errors = errors
        });
      }
      catch (COMException ex) when (ex.ErrorCode == unchecked((int)0x80040154))
      {
        errors.Add("Драйвер ККМ не зарегистрирован. Установите драйвер Штрих-М (x86).");
        return Ok(new
        {
          ready = false,
          connected = false,
          paper = true,
          kktNumber = (string?)null,
          shiftNumber = (int?)null,
          cashierName = (string?)null,
          receiptOpened = false,
          errors = errors
        });
      }
      catch (Exception ex)
      {
        errors.Add(ex.Message);
        return Ok(new
        {
          ready = false,
          connected = false,
          paper = true,
          kktNumber = (string?)null,
          shiftNumber = (int?)null,
          cashierName = (string?)null,
          receiptOpened = false,
          errors = errors
        });
      }
      finally
      {
        if (driver != null && Marshal.IsComObject(driver))
          Marshal.FinalReleaseComObject(driver);
      }
    }

    // --------------------- POST /openshift ---------------------
    [HttpPost("openshift")]
    public IActionResult OpenShift()
    {
      DrvFR? driver = null;
      try
      {
        driver = new DrvFR();
        dynamic fr = driver;
        ConfigureAndConnect(fr);
        if (CheckResult(fr, out string errMsg))
          return BadRequest(new { error = errMsg });

        fr.OpenShift();
        if (CheckResult(fr, out errMsg))
          return BadRequest(new { error = errMsg });

        return Ok(new { message = "Смена успешно открыта" });
      }
      catch (Exception ex)
      {
        return StatusCode(500, new { error = ex.Message });
      }
      finally
      {
        if (driver != null && Marshal.IsComObject(driver))
          Marshal.FinalReleaseComObject(driver);
      }
    }

    // --------------------- POST /xreport ---------------------
    [HttpPost("xreport")]
    public IActionResult PrintXReport()
    {
      DrvFR? driver = null;
      try
      {
        driver = new DrvFR();
        dynamic fr = driver;
        ConfigureAndConnect(fr);
        if (CheckResult(fr, out string errMsg))
          return StatusCode(500, new { error = errMsg });

        fr.PrintReportWithoutCleaning();
        if (CheckResult(fr, out errMsg))
          return StatusCode(500, new { error = "Ошибка X-отчёта: " + errMsg });

        WaitForPrintComplete(fr);
        return Ok(new { message = "X-отчёт напечатан" });
      }
      catch (Exception ex)
      {
        return StatusCode(500, new { error = ex.ToString() });
      }
      finally
      {
        if (driver != null && Marshal.IsComObject(driver))
          Marshal.FinalReleaseComObject(driver);
      }
    }

    // --------------------- POST /zreport ---------------------
    [HttpPost("zreport")]
    public IActionResult PrintZReport()
    {
      DrvFR? driver = null;
      try
      {
        driver = new DrvFR();
        dynamic fr = driver;
        ConfigureAndConnect(fr);
        if (CheckResult(fr, out string errMsg))
          return StatusCode(500, new { error = errMsg });

        fr.PrintReportWithCleaning();
        if (CheckResult(fr, out errMsg))
          return StatusCode(500, new { error = "Ошибка Z-отчёта: " + errMsg });

        WaitForPrintComplete(fr);
        return Ok(new { message = "Z-отчёт напечатан, смена закрыта" });
      }
      catch (Exception ex)
      {
        return StatusCode(500, new { error = ex.ToString() });
      }
      finally
      {
        if (driver != null && Marshal.IsComObject(driver))
          Marshal.FinalReleaseComObject(driver);
      }
    }

    // --------------------- GET /diagnostic ---------------------
    [HttpGet("diagnostic")]
    public IActionResult Diagnostic()
    {
      var result = new List<string>();
      try
      {
        var driver = new DrvFR();
        dynamic fr = driver;
        result.Add($"COM port: {ComPort - 1}");
        result.Add($"BaudRate: {BaudRate}");
        result.Add($"Timeout: {Timeout}");

        fr.Password = Password;
        fr.ComNumber = ComPort - 1;
        fr.BaudRate = BaudRate;
        fr.Timeout = Timeout;
        fr.LDNumber = 1;

        var sw = System.Diagnostics.Stopwatch.StartNew();
        fr.Connect();
        sw.Stop();
        result.Add($"Connect elapsed: {sw.ElapsedMilliseconds} ms, ResultCode: {fr.ResultCode}");

        if (fr.ResultCode == 0)
        {
          fr.GetECRStatus();
          result.Add($"GetECRStatus: ResultCode={fr.ResultCode}, Mode={fr.ECRMode}, Session={fr.SessionNumber}");
        }
        else
        {
          result.Add($"Ошибка: {fr.ResultCodeDescription}");
        }
      }
      catch (Exception ex)
      {
        result.Add($"Exception: {ex.Message}");
      }
      return Ok(result);
    }

    // --------------------- POST /printreceipt ---------------------
    [HttpPost("printreceipt")]
    public IActionResult PrintReceipt([FromBody] ReceiptData receipt)
    {
      if (receipt?.Items == null || receipt.Items.Count == 0)
        return BadRequest(new { error = "Нет товаров для чека" });

      DrvFR? driver = null;
      try
      {
        driver = new DrvFR();
        dynamic fr = driver;
        ConfigureAndConnect(fr);
        if (CheckResult(fr, out string errMsg))
          return StatusCode(500, new { error = errMsg });

        // Устанавливаем имя кассира (если передано)
        string cashier = string.IsNullOrWhiteSpace(receipt.CashierName) ? "Оператор" : receipt.CashierName;
        fr.OperatorName = cashier;

        // Устанавливаем внешний номер чека, если поддерживается драйвером
        if (receipt.ReceiptNumber.HasValue && receipt.ReceiptNumber.Value > 0)
        {
          try { fr.DocumentNumber = receipt.ReceiptNumber.Value; } catch { /* не все модели поддерживают */ }
        }

        fr.OpenCheck();
        if (CheckResult(fr, out errMsg))
          return StatusCode(500, new { error = "Ошибка открытия чека: " + errMsg });

        foreach (var item in receipt.Items)
        {
          fr.Price = (decimal)item.Price;
          fr.Quantity = (decimal)item.Quantity;
          fr.Department = item.Department;
          fr.Tax = item.Tax;
          fr.Text = item.Name;
          fr.Sale();

          if (CheckResult(fr, out errMsg))
          {
            fr.CancelCheck();
            return StatusCode(500, new { error = $"Ошибка при добавлении товара '{item.Name}': {errMsg}" });
          }
        }

        fr.PaymentType = 0;               // 0 – наличные
        double total = receipt.TotalCash ?? receipt.Items.Sum(i => i.Price * i.Quantity);
        fr.Summ = (decimal)total;
        fr.CloseCheck();

        if (CheckResult(fr, out errMsg))
        {
          fr.CancelCheck();
          return StatusCode(500, new { error = "Ошибка закрытия чека: " + errMsg });
        }

        try { fr.CutCheck(); } catch { /* не критично */ }

        return Ok(new { message = "Чек успешно напечатан" });
      }
      catch (Exception ex)
      {
        return StatusCode(500, new { error = ex.ToString() });
      }
      finally
      {
        if (driver != null && Marshal.IsComObject(driver))
          Marshal.FinalReleaseComObject(driver);
      }
    }

    // --------------------- Вспомогательные методы ---------------------
    private static void ConfigureAndConnect(dynamic fr)
    {
      fr.Password = Password;
      fr.ComNumber = ComPort - 1;
      fr.BaudRate = BaudRate;
      fr.Timeout = Timeout;
      fr.LDNumber = 1;
      fr.Connect();
    }

    private static bool CheckResult(dynamic fr, out string errorMessage)
    {
      if (fr.ResultCode == 0)
      {
        errorMessage = string.Empty;
        return false;
      }
      errorMessage = $"{fr.ResultCode} - {fr.ResultCodeDescription}";
      return true;
    }

    private static void WaitForPrintComplete(dynamic fr)
    {
      for (int i = 0; i < 20; i++)
      {
        System.Threading.Thread.Sleep(300);
        fr.GetECRStatus();
        if (fr.ResultCode != 0) break;
        if (fr.ECRAdvancedMode != 2 && fr.ECRAdvancedMode != 3)
          break;
      }
    }
  }

  // Модели для JSON
  public class ReceiptData
  {
    public List<ReceiptItem> Items { get; set; } = new();
    public double? TotalCash { get; set; }
    public string CashierName { get; set; } = "";   // имя кассира
    public int? ReceiptNumber { get; set; }          // внешний номер чека
  }

  public class ReceiptItem
  {
    public string Name { get; set; } = "";
    public double Price { get; set; }
    public double Quantity { get; set; } = 1;
    public int Department { get; set; } = 1;
    public int Tax { get; set; } = 4;      // 4 = НДС 20%
  }

  public class Program
  {
    public static void Main(string[] args)
    {
      CreateHostBuilder(args).Build().Run();
    }

    public static IHostBuilder CreateHostBuilder(string[] args) =>
        Host.CreateDefaultBuilder(args)
            .ConfigureWebHostDefaults(webBuilder =>
            {
              webBuilder.UseStartup<Startup>();
              webBuilder.UseUrls("http://0.0.0.0:5001");
            });
  }
}
