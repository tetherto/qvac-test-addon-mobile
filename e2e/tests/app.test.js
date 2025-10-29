const { expect, driver } = require("@wdio/globals");

describe('Runner', () => {
    //START TEST
    it('initialize app', async () => {
        const text = await getElementByText('INITIALIZED')

        await text.waitUntil(async () => {
            return await text.isDisplayed()
        }, {
            timeout: 10000,
            interval: 1000
        })

        expect(await text.isDisplayed()).toBe(true)
    })

    //GENERATED TESTS

    it('startTest', async () => {
        // Wait for test result to appear
        const passText = await getElementByText('startTest: PASS')
        const failText = await getElementByText('startTest: FAIL')
        
        // Wait for either pass or fail with a generous timeout
        await driver.waitUntil(async () => {
            const passDisplayed = await passText.isDisplayed().catch(() => false)
            const failDisplayed = await failText.isDisplayed().catch(() => false)
            return passDisplayed || failDisplayed
        }, {
            timeout: 30000,
            interval: 500,
            timeoutMsg: 'Test startTest did not complete within 30 seconds'
        })
        
        // Check which one is displayed
        const passDisplayed = await passText.isDisplayed().catch(() => false)
        const failDisplayed = await failText.isDisplayed().catch(() => false)
        
        // Test should pass (not fail)
        expect(passDisplayed).toBe(true)
        expect(failDisplayed).toBe(false)
    })
    //END GENERATED TESTS
})


async function getElementByText(text) {
    if (driver.isAndroid) {
        return await driver.$(`android=new UiSelector().textContains("${text}")`);
    }
    return await driver.$(`-ios predicate string:label CONTAINS "${text}"`);
}
