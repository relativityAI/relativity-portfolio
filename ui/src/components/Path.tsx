import { Flex } from "@chakra-ui/react"
import { Breadcrumb } from "@chakra-ui/react"

function capitalize(item) {

    const words = item.split("-")
    let out = ""
    for (const word of words){
        out += word.charAt(0).toUpperCase() + word.slice(1)
        out += " "
    } 
    return out
}

export default function Path(props) {

    const loc = props.path.trim().split("/").filter(Boolean);

    let urlmap = new Map();
    urlmap.set("Dashboard", "/")
    let runningUrl = "";
    for (let i = 1; i < loc.length; i++) {
        let item = loc[i];
        runningUrl = runningUrl + "/" + item;
        urlmap.set(
            // Page name : /path/to/page
            capitalize(item),
            runningUrl
        )
    }

    const paths = ["/"]
    const currentLocation = capitalize(loc[loc.length - 1]);

    let p = "/"
    for (let i = 1; i < loc.length; i++) {
        p = p + loc[i]
        paths.push(p)
        p = p + "/"
    }

    return (
        <Breadcrumb.Root paddingX={4} margin={0} size="sm" variant="underline">
            <Breadcrumb.List>

                {Array.from(urlmap.keys()).map((key, index) => {
                    const url = urlmap.get(key);
                    if (key == currentLocation) {
                        return (
                            <Breadcrumb.Item key={key}>
                                <Breadcrumb.CurrentLink>{key}</Breadcrumb.CurrentLink>
                            </Breadcrumb.Item>
                        )
                    } else {
                        // let path = ;
                        return (
                            <Flex gap={1} align="center" key={key}>
                                <Breadcrumb.Item>
                                    <Breadcrumb.Link href={url}>{key}</Breadcrumb.Link>
                                </Breadcrumb.Item>
                                <Breadcrumb.Separator />

                            </Flex>

                        )
                    }
                }
                )}

            </Breadcrumb.List>

        </Breadcrumb.Root>
    )


}

