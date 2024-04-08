import { Dictionary } from "typescript-collections";
import { PointF2D } from "../Common/DataObjects/PointF2D";
import { EngravingRules } from "../MusicalScore/Graphical/EngravingRules";
import { GraphicalMeasure } from "../MusicalScore/Graphical/GraphicalMeasure";
import { OpenSheetMusicDisplay } from "../OpenSheetMusicDisplay/OpenSheetMusicDisplay";
import { GraphicalStaffEntry } from "../MusicalScore/Graphical/GraphicalStaffEntry";
import { MusicPartManagerIterator } from "../MusicalScore/MusicParts/MusicPartManagerIterator";
import { CursorType } from "../OpenSheetMusicDisplay/OSMDOptions";
import { SourceMeasure } from "../MusicalScore/VoiceData/SourceMeasure";
// import { IXmlElement } from "../Common/FileIO/Xml";

/** Listens for clicks and selects current measure etc.
 * This is similar to classes like SheetRenderingManager and WebSheetRenderingManager in the audio player,
 * but for now we port only the necessary elements and simplify them for the measure width editor use case.
 */
export class ClickListener {
    public rules: EngravingRules;
    private osmdContainer: HTMLElement;
    private osmd: OpenSheetMusicDisplay;
    private currentMeasure: GraphicalMeasure;
    private lastMeasureClicked: GraphicalMeasure;
    /** The MusicXML string loaded by OSMD, before modifications. */
    private loadedXML: string;
    /** The modified MusicXML with widthFactor and globalScale inserted. (-> download xml button) */
    private modifiedXML: string;
    public filename: string;
    private measureWidthInput: HTMLElement;
    private globalScaleInput: HTMLElement;
    /** Percentage steps for + and - buttons as decimal. E.g. 0.05 = 5% steps. */
    public percentageStep: number = 0.05;

    protected EventCallbackMap: Dictionary<string, [HTMLElement|Document, EventListener]> =
                new Dictionary<string, [HTMLElement|Document, EventListener]>();

    constructor(osmd: OpenSheetMusicDisplay) {
        this.osmd = osmd;
        this.rules = osmd.EngravingRules;
        this.osmdContainer = this.rules.Container;
        this.init();
    }

    public init(): void {
        this.listenForInteractions();
        // save the XML osmd loaded. note that the function is reset by osmd.setOptions() if not provided.
        this.osmd.OnXMLRead = (fileString: string): string => {
            this.loadedXML = fileString;
            return fileString;
        };
    }

    private listenForInteractions(): void {
        const downEvent: (clickEvent: MouseEvent | TouchEvent) => void = this.downEventListener.bind(this);
        // const endTouchEvent: (clickEvent: TouchEvent) => void = this.touchEndEventListener.bind(this);
        // const moveEvent: (clickEvent: MouseEvent | TouchEvent) => void = this.moveEventListener.bind(this);
        this.osmdContainer.addEventListener("mousedown", downEvent);
        // this.osmdContainer.addEventListener("touchend", endTouchEvent);
        // document.addEventListener(this.moveEventName, moveEvent);
        this.EventCallbackMap.setValue("mousedown", [this.osmdContainer, downEvent]);
        // this.EventCallbackMap.setValue("touchend", [this.osmdContainer, endTouchEvent]);
        // this.EventCallbackMap.setValue(this.moveEventName, [document, moveEvent]);

        const sheetMinusBtn: HTMLElement = document.getElementById("sheet-minus-btn");
        const sheetPlusBtn: HTMLElement = document.getElementById("sheet-plus-btn");
        const measureMinusBtn: HTMLElement = document.getElementById("measure-width-minus-btn");
        const measurePlusBtn: HTMLElement = document.getElementById("measure-width-plus-btn");
        const toggleCursorBtn: HTMLElement = document.getElementById("toggle-cursor-btn");
        const downloadBtn: HTMLElement = document.getElementById("download-xml-btn");

        this.measureWidthInput = document.getElementById("measure-width-display");
        this.globalScaleInput = document.getElementById("sheet-factor-display");
        const sheetMinusWidthEvent: (clickEvent: MouseEvent | TouchEvent) => void = this.sheetMinusWidthListener.bind(this);
        sheetMinusBtn.addEventListener("click", sheetMinusWidthEvent);
        const sheetPlusWidthEvent: (clickEvent: MouseEvent | TouchEvent) => void = this.sheetPlusWidthListener.bind(this);
        sheetPlusBtn.addEventListener("click", sheetPlusWidthEvent);
        const measureMinusEvent: (clickEvent: MouseEvent | TouchEvent) => void = this.measureMinusListener.bind(this);
        measureMinusBtn.addEventListener("click", measureMinusEvent);
        const measurePlusEvent: (clickEvent: MouseEvent | TouchEvent) => void = this.measurePlusListener.bind(this);
        measurePlusBtn.addEventListener("click", measurePlusEvent);
        const toggleCursorEvent: (clickEvent: MouseEvent | TouchEvent) => void = this.toggleCursorListener.bind(this);
        toggleCursorBtn.addEventListener("click", toggleCursorEvent);
        const downloadXmlEvent: (clickEvent: MouseEvent | TouchEvent) => void = this.downloadXmlListener.bind(this);
        downloadBtn.addEventListener("click", downloadXmlEvent);
        const measureInputEvent: (event: InputEvent) => void = this.measureInputListener.bind(this);
        this.measureWidthInput.addEventListener("input", measureInputEvent);
        const globalScaleInputEvent: (event: InputEvent) => void = this.globalScaleInputListener.bind(this);
        this.globalScaleInput.addEventListener("input", globalScaleInputEvent);
        (this.globalScaleInput as any).value = "100%"; // without this, it's not editable on loading the page
    }

    public SheetRendered(): void {
        this.updateSheetFactorDisplay();
        this.updateFilenameDisplay();
    }

    /** Called when new sheet was loaded and rendered, e.g. via drag and drop. */
    public NewSheetLoaded(): void {
        this.currentMeasure = undefined;
        this.updateSelectedMeasureField("-");
    }

    public getPositionInUnits(relativePositionX: number, relativePositionY: number): PointF2D {
        const position: PointF2D = new PointF2D(relativePositionX, relativePositionY);
        if (this.rules.RenderSingleHorizontalStaffline) {
            position.x += this.rules.Container.scrollLeft / this.rules.DisplayWidth;
            // TODO move this to mouseMoved() mouseUp() positionTouched() or sth.
            //   Also, don't we have offset values for things like this somewhere?
        }
        return this.transformToUnitCoordinates(position);
    }

    /**
     * @param relativeScreenPosition The relative position on the whole screen,
     * not on the ScreenViewingRegion (only if the region stretches over the whole screen).
     */
    public transformToUnitCoordinates(relativeScreenPosition: PointF2D): PointF2D {
        // const position: PointF2D = new PointF2D(this.UpperLeftPositionInUnits.x + this.ViewRegionInUnits.width *
        //                                         ((relativeScreenPosition.x - this.RelativeDisplayPosition.x) / this.RelativeDisplaySize.width),
        //                                         this.UpperLeftPositionInUnits.y + this.ViewRegionInUnits.height *
        //                                         ((relativeScreenPosition.y - this.RelativeDisplayPosition.y) / this.RelativeDisplaySize.height));
        let viewWidth: number = this.osmd.Sheet.pageWidth;
        if (this.rules.RenderSingleHorizontalStaffline) {
            // without this, clicking doesn't work for RenderSingleHorizontalStaffline, gets extremely high coordinates
            viewWidth = this.rules.Container.offsetWidth / this.osmd.zoom / 10.0;
        }
        const viewHeight: number = this.rules.DisplayHeight / this.osmd.zoom / 10.0;
        const position: PointF2D = new PointF2D(relativeScreenPosition.x * viewWidth, relativeScreenPosition.y * viewHeight);
        return position;
    }

    private downEventListener(clickEvent: MouseEvent | TouchEvent): void {
        //clickEvent.preventDefault();
        let x: number = 0;
        let y: number = 0;
        if (this.isTouch() && clickEvent instanceof TouchEvent) {
            x = clickEvent.touches[0].pageX;
            y = clickEvent.touches[0].pageY;
        } else if (clickEvent instanceof MouseEvent) {
            x = clickEvent.pageX;
            y = clickEvent.pageY;
        }
        const clickMinusOffset: PointF2D = this.getOffsetCoordinates(x, y);
        if (clickMinusOffset.y > this.osmdContainer.clientHeight) {
            // e.g. scrollbar click: ignore
            return;
        }

        // if (clickLength < this.DOUBLE_CLICK_WINDOW && clickLength > 0) { // double click
        this.click(clickMinusOffset.x, clickMinusOffset.y);
    }

    protected click(positionInPixelX: number, positionInPixelY: number): void {
        // don't click, if it was a move:
        // changed to still fire click even for small movements (needed for ios, as no touches began fires at view border.)
        // if (!this.mouseDidMove(this.lastPixelX, positionInPixelX, this.lastPixelY, positionInPixelY) && !this.ZoomGestureActive) {
        const relativePositionX: number = positionInPixelX / this.rules.DisplayWidth;
        const relativePositionY: number = positionInPixelY / this.rules.DisplayHeight;
        // for (const listener of this.listeners) {
        //     listener.positionTouched(relativePositionX, relativePositionY);
        // }
        const clickPosition: PointF2D = this.getPositionInUnits(relativePositionX, relativePositionY);
        // this.unitPosTouched(clickPosition, relativePositionX, relativePositionY);
        const nearestStaffEntry: GraphicalStaffEntry = this.osmd.GraphicSheet.GetNearestStaffEntry(clickPosition);
        // const nearestMeasure: GraphicalMeasure = this.osmd.GraphicSheet.GetNearestObject<GraphicalMeasure>(clickPosition, "GraphicalMeasure");
        // const nearestMeasure: GraphicalMeasure = this.osmd.GraphicSheet.getClickedObjectOfType<GraphicalMeasure>(clickPosition);
        if (nearestStaffEntry) {
            this.osmd.cursor.iterator = new MusicPartManagerIterator(this.osmd.Sheet, nearestStaffEntry.getAbsoluteTimestamp());
            this.currentMeasure = this.osmd.cursor.GNotesUnderCursor()[0]?.parentVoiceEntry.parentStaffEntry.parentMeasure;
            if (this.lastMeasureClicked === this.currentMeasure) {
                this.toggleCursorListener(); // toggle cursor (highlight / de-highlight)
                this.lastMeasureClicked = this.currentMeasure;
                return; // could also use an else block instead, but increases indentation
            }
            this.osmd.cursor.CursorOptions.type = CursorType.CurrentArea;
            this.osmd.cursor.CursorOptions.alpha = 0.1; // make this more transparent so that it's easier to judge the measure visually
            this.osmd.cursor.show();
            this.osmd.cursor.update();
            this.updateSelectedMeasureField(this.currentMeasure?.MeasureNumber.toString());
            this.updateMeasureWidthDisplay();
            this.lastMeasureClicked = this.currentMeasure;
        }
    }

    private updateSelectedMeasureField(selectedMeasure: string): void {
        document.getElementById("selected-measure-field").innerHTML = `Selected Measure: ${selectedMeasure}`;
    }

    private getOffsetCoordinates(clickX: number, clickY: number): PointF2D {
        let fullOffsetTop: number = 0;
        let nextOffsetParent: HTMLElement = this.osmdContainer;
        while (nextOffsetParent) {
            fullOffsetTop += nextOffsetParent.offsetTop;
            nextOffsetParent = nextOffsetParent.offsetParent as HTMLElement;
        }

        const sheetX: number = clickX; // - this.fullOffsetLeft + this.fullScrollLeft;
        const sheetY: number = clickY - fullOffsetTop; // + this.fullScrollTop;
        return new PointF2D(sheetX, sheetY);
    }

    //TODO: Much of this pulled from annotations code. Once we get the two branches together, combine common code
    private isTouch(): boolean {
        if (("ontouchstart" in window) || (window as any).DocumentTouch) {
            return true;
        }
        if (!window.matchMedia) {
            return false; // if running browserless / in nodejs (generateImages / visual regression tests)
        }
        // include the 'heartz' as a way to have a non matching MQ to help terminate the join
        // https://git.io/vznFH
        const prefixes: string[] = ["-webkit-", "-moz-", "-o-", "-ms-"];
        const query: string = ["(", prefixes.join("touch-enabled),("), "heartz", ")"].join("");
        return window.matchMedia(query).matches;
    }

    public Dispose(): void {
        for(const eventName of this.EventCallbackMap.keys()){
            const result: [HTMLElement|Document, EventListener] = this.EventCallbackMap.getValue(eventName);
            result[0].removeEventListener(eventName, result[1]);
        }
        this.EventCallbackMap.clear();
    }

    private measureMinusListener(clickEvent: MouseEvent | TouchEvent): void {
        if (!this.currentMeasure) {
            console.log("no current measure selected. ignoring minus button");
            return;
        }
        let widthFactor: number = this.currentMeasure.parentSourceMeasure.WidthFactor;
        widthFactor = Number.parseFloat((widthFactor - this.percentageStep).toFixed(2)); // prevent e.g. 1.20000001 (float inaccuracy)
        this.currentMeasure.parentSourceMeasure.WidthFactor = widthFactor;
        this.updateMeasureWidthDisplay();
        this.renderAndScrollBack();
    }

    private measurePlusListener(clickEvent: MouseEvent | TouchEvent): void {
        if (!this.currentMeasure) {
            console.log("no current measure selected. ignoring plus button");
            return;
        }
        let widthFactor: number = this.currentMeasure.parentSourceMeasure.WidthFactor;
        widthFactor = Number.parseFloat((widthFactor + this.percentageStep).toFixed(2)); // prevent e.g. 1.20000001 (float inaccuracy)
        this.currentMeasure.parentSourceMeasure.WidthFactor = widthFactor;
        this.updateMeasureWidthDisplay();
        this.renderAndScrollBack();
    }

    private measureInputListener(event: InputEvent): void {
        if (!this.currentMeasure) {
            console.log("no current measure selected. ignoring measure width input");
            return;
        }
        const inputString: string = (this.measureWidthInput as any).value.replace("%","").replace(",",".");
        const inputValue: number = Number.parseFloat(inputString);
        if (inputValue < 10 || inputValue > 500) {
            return; // doesn't make sense to set values < 10%. and you can still do it with the minus button.
        }
        if (typeof inputValue !== ("number") || isNaN(inputValue)) {
            console.log("invalid measure width input");
            return;
        }
        this.currentMeasure.parentSourceMeasure.WidthFactor = inputValue / 100;
        this.renderAndScrollBack();
    }

    private globalScaleInputListener(event: InputEvent): void {
        // if (event.inputType === "deleteContentBackward") {
        //     return; // don't re-render on hitting backspace (e.g. 90% -> 9%)
        // }
        const inputString: string = (this.globalScaleInput as any).value.replace("%","").replace(",",".");
        if (inputString === "") {
            return;
        }
        const inputValue: number = Number.parseFloat(inputString);
        if (typeof inputValue !== ("number") || isNaN(inputValue)) {
            console.log("invalid global scale input");
            return;
        }
        if (inputValue < 50 || inputValue > 500) {
            console.log("global scale < 50 too low or > 300 too high.");
            // if (inputValue >= 10) {
            //     // reset to 50% to indicate that that's the minimum
            //     inputValue = 50;
            //     (this.globalScaleInput as any).value = "50%"; // this can be irritating
            // } else {
                return; // doesn't make sense to set values < 50%, can crash OSMD
            // }
        }
        this.osmd.Sheet.MeasureWidthFactor = inputValue / 100;
        this.renderAndScrollBack();
    }

    private sheetMinusWidthListener(): void {
        let widthFactor: number = this.osmd.Sheet.MeasureWidthFactor;
        widthFactor = Number.parseFloat((widthFactor - this.percentageStep).toFixed(2)); // prevent e.g. 1.20000001 (float inaccuracy)
        this.osmd.Sheet.MeasureWidthFactor = widthFactor;
        this.updateSheetFactorDisplay();
        this.renderAndScrollBack();
    }

    private sheetPlusWidthListener(): void {
        let widthFactor: number = this.osmd.Sheet.MeasureWidthFactor;
        widthFactor = Number.parseFloat((widthFactor + this.percentageStep).toFixed(2)); // prevent e.g. 1.20000001 (float inaccuracy)
        this.osmd.Sheet.MeasureWidthFactor = widthFactor;
        this.updateSheetFactorDisplay();
        this.renderAndScrollBack();
    }

    private updateSheetFactorDisplay(): void {
        const percent: number = this.osmd.Sheet.MeasureWidthFactor * 100;
        const percentString: string = percent.toFixed(0);
        (this.globalScaleInput as any).value = `${percentString}%`;
    }

    private updateFilenameDisplay(): void {
        if (this.rules.Filename) {
            const filenameElement: HTMLElement = document.getElementById("filename-display");
            filenameElement.innerHTML = `${this.rules.Filename}`;
        }
    }

    private toggleCursorListener(): void {
        if (this.osmd.cursor.hidden) {
            this.osmd.cursor.show();
        } else {
            this.osmd.cursor.hide();
        }
    }

    private renderAndScrollBack(): void {
        // scroll back to the previous scrollX if we scrolled horizontally then re-rendered
        //   (without this, after rendering, it "scrolled back" to the initial 0 horizontal scroll / reset scroll)
        const currentScrollX: number = this.osmdContainer.scrollLeft;
        this.osmd.render();
        this.osmdContainer.scrollLeft = currentScrollX;
    }

    private downloadXmlListener(): void {
        // analogous to osmd.load()
        const parser: DOMParser = new DOMParser();
        const content: Document = parser.parseFromString(this.loadedXML, "application/xml");
        const nodes: NodeList = content.childNodes;
        this.modifyNodesRecursive(nodes);

        const outerHTML: string = content.documentElement.outerHTML; // outer includes <score-partwise>, which inner doesn't
        const encoding: string = "UTF-8";
        const xmlHeader: string = `<?xml version="1.0" encoding="${encoding}"?>`;
        this.modifiedXML = `${xmlHeader}\n${outerHTML}`;
        let filename: string = this.rules.Filename;
        if (!filename) {
            filename = "sample.musicxml";
        }
        this.downloadAsFile(this.modifiedXML, filename, encoding.toLowerCase());
    }

    private downloadAsFile(filecontent: string, filename: string, encoding: string): void {
        const hidden_a: HTMLElement = document.createElement("a");
        hidden_a.setAttribute("href", `data:text/plain;charset=${encoding},` + encodeURIComponent(filecontent));
        hidden_a.setAttribute("download", filename);
        document.body.appendChild(hidden_a);
        hidden_a.click();
        document.body.removeChild(hidden_a);
    }

    private modifyNodesRecursive(nodes: NodeList): NodeList {
        let scorePartwiseElement: Element;
        for (let i: number = 0, length: number = nodes.length; i < length; i += 1) {
            const node: Node = nodes[i];
            if (node.nodeType !== Node.ELEMENT_NODE) {
                // e.g. text node (= 3. element node = 1 (enum value))
                continue;
            }
            const delta: number = 0.00001; // delta for floating point inaccuracy tolerance
            if (node.nodeName.toLowerCase() === "score-partwise") {
                scorePartwiseElement = <Element>node;
                scorePartwiseElement.setAttribute("osmdMeasureWidthFactor", this.osmd.Sheet.MeasureWidthFactor.toString());
                if (Math.abs(this.osmd.Sheet.MeasureWidthFactor - 1.0) < delta) {
                    // basically if factor === 1.0, just catching floating point inaccuracy, e.g. 1.0000001
                    //   note that we technically don't need to do that, the factor is rounded already via toFixed()

                    // delete attribute: we don't need or want "widthFactor='1.0'" (100%) in the XML
                    scorePartwiseElement.removeAttribute("osmdMeasureWidthFactor");
                }
            } else if (node.nodeName.toLowerCase() === "measure") {
                const measureElement: Element = <Element>node;
                const measureNumber: number = Number.parseInt(measureElement.getAttribute("number"), 10);
                let foundMeasure: SourceMeasure;
                for (const sheetMeasure of this.osmd.Sheet.SourceMeasures) {
                    if (sheetMeasure.MeasureNumberXML === measureNumber) {
                        foundMeasure = sheetMeasure;
                        break;
                    }
                }
                if (!foundMeasure) {
                    console.log(`couldn't find measure ${measureNumber}`);
                    return;
                }
                const widthFactor: number = foundMeasure.WidthFactor;
                measureElement.setAttribute("osmdWidthFactor", widthFactor.toString());
                if (Math.abs(widthFactor - 1.0) < delta) {
                    measureElement.removeAttribute("osmdWidthFactor");
                }
            }
            this.modifyNodesRecursive(node.childNodes);
        }
        // const score: IXmlElement = new IXmlElement(scorePartwiseElement);
        // for (const nodeEntry of nodes.entries()) {
        //     const node = nodeEntry[1];
        //     if (node.nodeName === "measure") {
        //         const number: string = node.attribute("number");
        //     }
        //     console.log(node);
        // }

        return nodes;
    }

    private updateMeasureWidthDisplay(): void {
        const percent: number = this.currentMeasure.parentSourceMeasure.WidthFactor * 100;
        const percentString: string = percent.toFixed(0);
        (this.measureWidthInput as any).value = `${percentString}%`;
    }
}
