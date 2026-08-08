// ==UserScript==
// @name         cto.new keepalive
// @namespace    http://tampermonkey.net/
// @version      2026-04-21
// @description  cto.new keepalive
// @author       vevc
// @match        https://cto.new/business/*/files
// @icon         https://www.google.com/s2/favicons?sz=64&domain=cto.new
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const FILE_A = 'docker-compose.yml';
    const FILE_B = 'node.txt';

    // 查找页面上文本内容（去除空白后）严格等于指定文字的"叶子"元素
    // 只取没有子元素的节点，避免重复匹配到父容器
    function findElementsByExactText(text) {
        const result = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
        let node;
        while ((node = walker.nextNode())) {
            if (node.children.length === 0 && node.textContent.trim() === text) {
                result.push(node);
            }
        }
        return result;
    }

    // 找到文字所对应的可点击元素，优先向上找最近的 button / a / role=button
    function findClickTarget(text) {
        const elements = findElementsByExactText(text);
        for (const el of elements) {
            let current = el;
            while (current && current !== document.body) {
                const tag = current.tagName.toLowerCase();
                const role = current.getAttribute && current.getAttribute('role');
                if (tag === 'button' || tag === 'a' || role === 'button' || role === 'link') {
                    return current;
                }
                current = current.parentElement;
            }
        }
        return elements[0] || null;
    }

    function runTask() {
        const aCount = findElementsByExactText(FILE_A).length;

        let target = null;
        if (aCount > 1) {
            target = findClickTarget(FILE_B);
        } else {
            target = findClickTarget(FILE_A);
        }

        if (target) {
            target.click();
        }
    }

    setInterval(runTask, 30000);

    // 每 4 小时，强制刷新一次网页，防内存泄漏
    // 4小时 = 4 * 60 * 60 * 1000 = 14400000 毫秒
    setTimeout(() => {
        location.reload();
    }, 14400000);

})();
