"""Browser QA against the local demo and its original HTML prototype.

Requires an existing Playwright Python installation and local app on 5173/3333.
Run: python scripts/visual_qa.py --final
The optional full prototype comparison requires the reference HTML in Downloads,
or PRECO_CERTO_PROTOTYPE pointing to it: python scripts/visual_qa.py
"""

from pathlib import Path
import json
import os
import sys

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "artifacts" / "visual-qa"
PROTOTYPE = Path(os.environ.get("PRECO_CERTO_PROTOTYPE", str(Path.home() / "Downloads" / "prototipo-gestao-precos-mercado-livre.html")))
APP = "http://127.0.0.1:5173/"
OUT.mkdir(parents=True, exist_ok=True)
checks = []


def check(name, condition):
    checks.append({"scenario": name, "status": "PASS" if condition else "FAIL"})
    if not condition:
        raise AssertionError(name)


def shot(page, filename):
    page.screenshot(path=str(OUT / filename), full_page=True, animations="disabled")


def no_overflow(page, label):
    widths = page.evaluate("""() => ({viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth})""")
    check(label + " without horizontal page overflow",
          widths["document"] <= widths["viewport"] + 1 and widths["body"] <= widths["viewport"] + 1)


def app_search(page, mode, value):
    page.locator("#searchMode").select_option(mode)
    page.locator("#searchInput").fill(value)
    page.get_by_role("button", name="Buscar e revisar anúncios").click()
    page.get_by_role("heading", name="2. Revise os anúncios encontrados").wait_for()


def app_flow(browser, label, width, height):
    context = browser.new_context(viewport={"width": width, "height": height}, device_scale_factor=1)
    page = context.new_page()
    page.goto(APP, wait_until="networkidle")
    check(label + " initial light theme", page.locator("html").get_attribute("data-theme") == "light")
    shot(page, f"app-{label}-step-1.png")
    no_overflow(page, label + " step 1")

    app_search(page, "name", "Capacete Norisk")
    check(label + " name search", page.locator(".review-table tbody tr").count() >= 5)
    check(label + " blocked listings", page.locator(".review-table tbody input:disabled").count() >= 1)
    shot(page, f"app-{label}-step-2.png")
    no_overflow(page, label + " step 2")

    page.locator("#selectionAccount").select_option("acc-norte")
    page.get_by_role("button", name="Selecionar conta").click()
    check(label + " selection by account", page.get_by_text("4 combinação(ões) selecionada(s)").count() == 1)
    page.get_by_label("Novo preço de NRK-FOR-P-PT").fill("600,00")
    check(label + " price edit", page.get_by_label("Novo preço de NRK-FOR-P-PT").input_value() == "600,00")
    page.get_by_role("button", name="Continuar para aprovação").click()
    shot(page, f"app-{label}-price-mismatch.png")
    check(label + " mismatched prices blocked", "Regra deste produto" in page.get_by_role("alert").first.inner_text()
          and page.get_by_role("heading", name="2. Revise os anúncios encontrados").count() == 1)
    page.get_by_label("Novo preço de NRK-FOR-P-PT").fill("529,90")
    page.get_by_role("button", name="Continuar para aprovação").click()
    page.get_by_role("heading", name="3. Aprovação final").wait_for()
    shot(page, f"app-{label}-step-3.png")
    no_overflow(page, label + " step 3")

    page.get_by_role("button", name="Confirmar simulação").click()
    check(label + " approval required", page.get_by_role("alert").get_by_text("Marque a confirmação").count() == 1)
    page.get_by_label("Confirmo que revisei os anúncios").check()
    page.get_by_role("button", name="Confirmar simulação").click()
    check(label + " confirmation dialog", page.get_by_role("dialog").count() == 1)
    page.get_by_role("button", name="Confirmar na demonstração").click()
    page.get_by_role("heading", name="Simulação concluída").wait_for()
    shot(page, f"app-{label}-step-4.png")
    no_overflow(page, label + " step 4")
    check(label + " result only simulated", page.get_by_text("Nenhum preço real foi alterado").count() == 1)
    protocol = page.locator(".result-body .tiny strong").inner_text()

    page.get_by_role("button", name="Ver histórico").click()
    page.get_by_role("heading", name="Histórico de alterações").wait_for()
    page.locator("#historySearch").fill(protocol)
    check(label + " history persistence/search", page.locator(".history-table tbody tr").count() == 4)
    page.locator("#historyFilter").select_option("simulated")
    check(label + " history filter", page.locator(".history-table tbody tr").count() == 4)
    page.locator(".history-table tbody tr").first.get_by_role("button", name="Detalhes").click()
    check(label + " history details", protocol in page.get_by_role("dialog").inner_text())
    page.get_by_role("button", name="Fechar").click()
    shot(page, f"app-{label}-history.png")
    no_overflow(page, label + " history")

    page.locator("#themePicker").select_option("dark")
    check(label + " dark theme", page.locator("html").get_attribute("data-theme") == "dark"
          and page.evaluate("localStorage.getItem('theme')") == "dark")
    shot(page, f"app-{label}-dark.png")
    page.reload(wait_until="networkidle")
    check(label + " theme persistence", page.locator("html").get_attribute("data-theme") == "dark")
    page.locator("#themePicker").select_option("light")
    check(label + " light theme restored", page.locator("html").get_attribute("data-theme") == "light")
    context.close()


def other_searches(browser):
    context = browser.new_context()
    page = context.new_page()
    page.goto(APP, wait_until="networkidle")
    app_search(page, "sku", "RT-CL-PT-56")
    check("exact SKU expands complete traditional group",
          all(page.get_by_text(sku, exact=True).count() for sku in ("RT-CL-PT-56", "RT-CL-PT-58", "RT-CL-VM-58")))
    page.get_by_role("button", name="Editar busca").click()
    app_search(page, "list", "RT-CL-PT-56; Norisk Force II,\nRT-CL-PT-56")
    check("mixed SKU/name list search", page.get_by_text("NRK-FOR-P-PT", exact=True).count() > 0
          and page.get_by_text("RT-CL-VM-58", exact=True).count() > 0)
    context.close()


def stale_snapshot(browser):
    context = browser.new_context()
    page = context.new_page()

    def alter_search(route):
        response = route.fetch()
        data = response.json()
        for listing in data["listings"]:
            if listing["sku"] == "NRK-FOR-P-PT":
                listing["price"] += 1
        route.fulfill(response=response, body=json.dumps(data))

    page.route("**/api/search", alter_search)
    page.goto(APP, wait_until="networkidle")
    app_search(page, "name", "Capacete Norisk")
    page.get_by_label("Selecionar NRK-FOR-P-PT").check()
    page.get_by_role("button", name="Continuar para aprovação").click()
    page.get_by_label("Confirmo que revisei os anúncios").check()
    page.get_by_role("button", name="Confirmar simulação").click()
    page.get_by_role("button", name="Confirmar na demonstração").click()
    page.get_by_role("heading", name="Operação bloqueada").wait_for()
    check("server blocks changed listing snapshot", page.get_by_text("Bloqueado", exact=True).count() >= 1)
    shot(page, "app-blocked-divergence.png")
    context.close()


def prototype_flow(browser, label, width, height):
    context = browser.new_context(viewport={"width": width, "height": height}, device_scale_factor=1)
    page = context.new_page()
    page.goto(PROTOTYPE.as_uri(), wait_until="load")
    page.locator("#searchMode").select_option("family")
    shot(page, f"prototype-{label}-step-1.png")
    page.evaluate("searchSku()")
    shot(page, f"prototype-{label}-step-2.png")
    page.evaluate("""() => { document.getElementById('selectionAccount').value='Loja Centro'; selectAccountRows(); toApproval(); }""")
    shot(page, f"prototype-{label}-step-3.png")
    page.evaluate("""() => { document.getElementById('approveCheck').checked=true; runDemo(); }""")
    shot(page, f"prototype-{label}-step-4.png")
    context.close()


def final_flow(browser, label, width, height):
    context = browser.new_context(viewport={"width": width, "height": height}, device_scale_factor=1)
    page = context.new_page()
    page.goto(APP, wait_until="networkidle")
    app_search(page, "name", "Capacete Norisk")
    page.locator("#selectionAccount").select_option("acc-norte")
    page.get_by_role("button", name="Selecionar conta").click()
    page.get_by_label("Novo preço de NRK-FOR-P-PT").fill("600,00")
    page.get_by_label("Novo preço de RT-CL-PT-56").fill("500,00")
    page.get_by_role("button", name="Continuar para aprovação").click()
    alerts = page.get_by_role("alert")
    check(label + " only one mismatch alert in review", alerts.count() == 1
          and page.locator(".review-top .mismatch-notice").count() == 1
          and page.locator(".error-banner").count() == 0)
    alert_text = alerts.first.inner_text()
    check(label + " mismatch identifies products, SKUs and prices",
          all(text in alert_text for text in ("Capacete Norisk Force II", "NRK-FOR-P-PT", "R$ 600,00",
                                            "Capacete Norisk Route Classic", "RT-CL-PT-56", "R$ 500,00")))
    check(label + " mismatch retains selection, values and highlights", page.locator(".price-mismatch").count() == 4
          and page.get_by_label("Selecionar NRK-FOR-P-PT").is_checked()
          and page.get_by_label("Novo preço de NRK-FOR-P-PT").input_value() == "600,00"
          and page.get_by_role("heading", name="2. Revise os anúncios encontrados").count() == 1)
    shot(page, f"final-divergence-{label}.png")
    no_overflow(page, label + " divergence")

    page.get_by_label("Novo preço de NRK-FOR-P-PT").fill("500,00")
    check(label + " correction removes alert and highlights", alerts.count() == 0
          and page.locator(".price-mismatch").count() == 0)
    shot(page, f"final-corrected-{label}.png")
    no_overflow(page, label + " corrected review")
    page.get_by_role("button", name="Continuar para aprovação").click()
    check(label + " reaches final approval", page.get_by_role("heading", name="3. Aprovação final").count() == 1)
    page.get_by_role("button", name="Voltar para revisão").click()
    check(label + " no stale alert after returning", alerts.count() == 0
          and page.locator(".price-mismatch").count() == 0)

    page.get_by_role("button", name="Contas conectadas").click()
    page.get_by_role("heading", name="Gerenciamento de contas").wait_for()
    account_text = page.locator("main.content").inner_text()
    check(label + " accounts menu and three demo accounts", page.locator(".account-manage").count() == 3
          and all(name in account_text for name in ("Moto Norte (DEMO)", "Capacetes Centro (DEMO)", "Rota Sul (DEMO)")))
    check(label + " accounts disclaim real connection", "Nenhuma conta real está conectada" in account_text
          and "não há conexão ativa com o Mercado Livre" in account_text
          and page.get_by_role("button", name="Conectar conta").is_disabled())
    check(label + " account actions disabled", all(button.is_disabled() for button in page.locator(".account-tools button").all()))
    shot(page, f"final-accounts-{label}.png")
    no_overflow(page, label + " accounts")
    check(label + " account cards contain content", page.evaluate("""() => [...document.querySelectorAll('.account-manage')]
        .every(el => el.scrollWidth <= el.clientWidth + 1)"""))

    page.get_by_role("button", name="Atualizar preços").click()
    page.get_by_role("button", name="Editar busca").click()
    page.get_by_role("button", name="Gerenciar").click()
    check(label + " manage button opens accounts", page.get_by_role("heading", name="Gerenciamento de contas").count() == 1)
    shot(page, f"final-accounts-gerenciar-{label}.png")
    no_overflow(page, label + " accounts via manage")
    context.close()


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    try:
        if "--final" in sys.argv:
            for label, width, height in (("desktop", 1440, 900), ("mobile", 390, 844)):
                final_flow(browser, label, width, height)
        else:
            for label, width, height in (("desktop", 1440, 900), ("mobile", 390, 844)):
                prototype_flow(browser, label, width, height)
                app_flow(browser, label, width, height)
            other_searches(browser)
            stale_snapshot(browser)
    finally:
        browser.close()

(OUT / ("results-final.json" if "--final" in sys.argv else "results.json")).write_text(json.dumps(checks, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(checks, ensure_ascii=False, indent=2))
